import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { OrganizerRepository } from "../organizer/organizer.repository";
import { eventResponse } from "../organizer/organizer.responses";
import { OrganizerWrites, checkEditable, notFound } from "../organizer/organizer-writes";
import type { ConfirmBannerDto, PresignBannerDto } from "./banner.dto";
import { BannerStorage } from "./banner.storage";
import {
  type BannerContentType,
  bannerKeyContentType,
  isBannerContentType,
  matchesMagicBytes,
  newBannerKey,
} from "./banner-file";

@Injectable()
export class BannerService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repo: OrganizerRepository,
    private readonly writes: OrganizerWrites,
    private readonly storage: BannerStorage,
  ) {}

  /** Bước 1: xác thực tenant, trạng thái, loại và kích thước; trả URL PUT có chữ ký. */
  async presign(tenant: string, eventId: string, dto: PresignBannerDto) {
    const event = await this.repo.event(tenant, eventId);
    if (!event) throw notFound();
    checkEditable(event.status);
    if (!isBannerContentType(dto.content_type)) {
      throw new ProblemException("INVALID_BANNER_TYPE", 400, "Chỉ nhận ảnh JPEG, PNG hoặc WebP");
    }
    if (dto.size_bytes > this.env.BANNER_MAX_BYTES) {
      throw new ProblemException(
        "BANNER_TOO_LARGE",
        400,
        `Ảnh tối đa ${this.env.BANNER_MAX_BYTES} byte`,
      );
    }
    const key = newBannerKey(event.id, dto.content_type);
    const upload = await this.storage.presignUpload(key, dto.content_type, dto.size_bytes);
    return {
      object_key: key,
      method: "PUT" as const,
      upload_url: upload.url,
      headers: upload.headers,
      expires_at: new Date(Date.now() + this.env.BANNER_PRESIGN_TTL_SECONDS * 1000).toISOString(),
      max_bytes: this.env.BANNER_MAX_BYTES,
    };
  }

  /**
   * Bước 3: kiểm tra object thật trên kho (tồn tại, kích thước, content-type, magic bytes)
   * rồi gắn `banner_key` vào sự kiện cùng khóa phiên bản và Idempotency-Key.
   */
  async confirm(
    tenant: string,
    eventId: string,
    dto: ConfirmBannerDto,
    idempotencyKey: string | undefined,
  ) {
    const contentType = bannerKeyContentType(eventId, dto.object_key);
    if (!contentType) {
      throw new ProblemException(
        "INVALID_BANNER_KEY",
        400,
        "object_key không thuộc sự kiện này hoặc sai định dạng",
      );
    }
    // Kiểm tra tenant trước khi chạm vào kho để không dò object của tenant khác.
    if (!(await this.repo.event(tenant, eventId))) throw notFound();

    return this.writes.run(
      tenant,
      idempotencyKey,
      "POST events/" + eventId.toLowerCase() + "/banner/confirm",
      { object_key: dto.object_key, version: dto.version },
      async (tx) => {
        await this.verifyUploaded(dto.object_key, contentType);
        return eventResponse(
          await this.repo.updateEvent(tx, tenant, eventId, {
            banner_key: dto.object_key,
            version: dto.version,
          }),
        );
      },
    );
  }

  private async verifyUploaded(key: string, contentType: BannerContentType): Promise<void> {
    const stored = await this.storage.inspect(key);
    if (!stored) {
      throw new ProblemException("BANNER_NOT_UPLOADED", 409, "Chưa thấy ảnh được tải lên khóa này");
    }
    const reject = async (code: string, detail: string): Promise<never> => {
      await this.storage.remove(key);
      throw new ProblemException(code, 400, detail);
    };
    if (stored.size < 1) await reject("INVALID_BANNER_CONTENT", "Ảnh rỗng");
    if (stored.size > this.env.BANNER_MAX_BYTES) {
      await reject("BANNER_TOO_LARGE", `Ảnh tối đa ${this.env.BANNER_MAX_BYTES} byte`);
    }
    const declared = stored.contentType?.split(";")[0].trim().toLowerCase();
    if (declared !== contentType) {
      await reject("BANNER_TYPE_MISMATCH", "Content-Type của ảnh không khớp khóa đã cấp");
    }
    if (!matchesMagicBytes(contentType, stored.head)) {
      await reject("INVALID_BANNER_CONTENT", "Nội dung file không đúng định dạng ảnh khai báo");
    }
  }
}
