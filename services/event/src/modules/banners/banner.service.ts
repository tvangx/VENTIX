import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { OrganizerRepository } from "../organizer/organizer.repository";
import { OrganizerWrites, checkEditable, notFound } from "../organizer/organizer-writes";
import type { ConfirmBannerDto, PresignBannerDto } from "./banner.dto";
import { BannerStorage } from "./banner.storage";
import { processBanner } from "./banner-image";
import {
  isBannerContentType,
  matchesMagicBytes,
  newPublicBannerKeys,
  publicAssetUrl,
  stagingKey,
  thumbnailKeyFor,
} from "./banner-file";

@Injectable()
export class BannerService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repo: OrganizerRepository,
    private readonly writes: OrganizerWrites,
    private readonly storage: BannerStorage,
  ) {}

  /** Bước 1: xác thực tenant, trạng thái, loại, kích thước; trả URL PUT vào khu staging. */
  async presign(
    tenant: string,
    eventId: string,
    dto: PresignBannerDto,
    idempotencyKey: string | undefined,
  ) {
    const event = await this.repo.event(tenant, eventId);
    if (!event) throw notFound();
    checkEditable(event.status);
    if (!isBannerContentType(dto.content_type)) {
      throw new ProblemException("INVALID_IMAGE_TYPE", 400, "Chỉ nhận ảnh JPEG, PNG hoặc WebP");
    }
    const contentType = dto.content_type;
    if (dto.size_bytes > this.env.UPLOAD_MAX_BYTES) {
      throw new ProblemException(
        "IMAGE_TOO_LARGE",
        400,
        `Ảnh tối đa ${this.env.UPLOAD_MAX_BYTES} byte`,
      );
    }
    return this.writes.run(
      tenant,
      idempotencyKey,
      "POST events/" + eventId.toLowerCase() + "/banner/presign",
      { content_type: contentType, size_bytes: dto.size_bytes },
      async () => {
        const uploadId = randomUUID();
        const upload = await this.storage.presignUpload(
          stagingKey(event.id, uploadId),
          contentType,
          dto.size_bytes,
        );
        return {
          upload_id: uploadId,
          method: "PUT",
          url: upload.url,
          headers: upload.headers,
          expires_at: new Date(
            Date.now() + this.env.UPLOAD_PRESIGN_TTL_SECONDS * 1000,
          ).toISOString(),
          max_bytes: this.env.UPLOAD_MAX_BYTES,
        };
      },
    );
  }

  /**
   * Bước 3: kiểm tra object staging, xử lý bằng sharp, ghi bản công khai, gắn `banner_key`
   * cùng khóa phiên bản và Idempotency-Key, rồi xóa staging.
   */
  async confirm(
    tenant: string,
    eventId: string,
    dto: ConfirmBannerDto,
    idempotencyKey: string | undefined,
  ) {
    // Kiểm tra tenant trước khi chạm vào kho để không dò object của tenant khác.
    if (!(await this.repo.event(tenant, eventId))) throw notFound();
    const staging = stagingKey(eventId, dto.upload_id);

    return this.writes.run(
      tenant,
      idempotencyKey,
      "POST events/" + eventId.toLowerCase() + "/banner/confirm",
      { upload_id: dto.upload_id.toLowerCase(), version: dto.version },
      async (tx) => {
        const source = await this.verifyStaged(staging);
        const processed = await processBanner(source).catch(async (error: unknown) => {
          // Qua được bước nhận dạng nhưng không giải mã được: file hỏng, xóa như các ca từ chối khác.
          await this.storage.remove(staging);
          throw error;
        });
        const keys = newPublicBannerKeys(eventId);
        try {
          await this.storage.putPublic(keys.banner, processed.banner, "image/webp");
          await this.storage.putPublic(keys.thumbnail, processed.thumbnail, "image/webp");
          const updated = await this.repo.updateEvent(tx, tenant, eventId, {
            banner_key: keys.banner,
            version: dto.version,
          });
          await this.storage.remove(staging);
          return {
            banner_key: keys.banner,
            banner_url: publicAssetUrl(this.env.PUBLIC_ASSET_BASE_URL, keys.banner),
            thumbnail_url: publicAssetUrl(
              this.env.PUBLIC_ASSET_BASE_URL,
              thumbnailKeyFor(keys.banner),
            ),
            version: updated.version,
          };
        } catch (error) {
          // Ghi DB hỏng (sai version, sự kiện đã khóa...) thì không để lại bản công khai mồ côi.
          await Promise.all([
            this.storage.remove(keys.banner),
            this.storage.remove(keys.thumbnail),
          ]);
          throw error;
        }
      },
    );
  }

  private async verifyStaged(key: string): Promise<Buffer> {
    const stored = await this.storage.inspect(key);
    if (!stored) {
      throw new ProblemException(
        "UPLOAD_NOT_FOUND",
        404,
        "Không thấy ảnh tải lên (chưa PUT, đã xác nhận hoặc đã hết hạn)",
      );
    }
    const reject = async (code: string, detail: string): Promise<never> => {
      await this.storage.remove(key);
      throw new ProblemException(code, 400, detail);
    };
    if (stored.size < 1) await reject("INVALID_IMAGE_CONTENT", "Ảnh rỗng");
    if (stored.size > this.env.UPLOAD_MAX_BYTES) {
      await reject("IMAGE_TOO_LARGE", `Ảnh tối đa ${this.env.UPLOAD_MAX_BYTES} byte`);
    }
    const declared = stored.contentType?.split(";")[0].trim().toLowerCase() ?? "";
    if (!isBannerContentType(declared)) {
      await reject("INVALID_IMAGE_TYPE", "Content-Type của ảnh không được hỗ trợ");
    } else if (!matchesMagicBytes(declared, stored.head)) {
      await reject("INVALID_IMAGE_CONTENT", "Nội dung file không đúng định dạng ảnh khai báo");
    }
    return this.storage.read(key);
  }
}
