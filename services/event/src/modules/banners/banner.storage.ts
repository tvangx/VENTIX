import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { BANNER_SNIFF_BYTES, type BannerContentType } from "./banner-file";

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface StoredBanner {
  size: number;
  contentType: string | undefined;
  /** Tối đa `BANNER_SNIFF_BYTES` byte đầu của object. */
  head: Buffer;
}

const STORAGE_TIMEOUT_MS = 5000;

function isMissing(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/** Kho banner trên MinIO/S3. Chỉ chứa thao tác I/O; quy tắc nghiệp vụ nằm ở BannerService. */
@Injectable()
export class BannerStorage implements OnModuleDestroy {
  private readonly client?: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.MINIO_ACCESS_KEY && env.MINIO_SECRET_KEY) {
      this.client = new S3Client({
        endpoint: env.MINIO_ENDPOINT,
        region: "us-east-1",
        forcePathStyle: true,
        maxAttempts: 2,
        requestChecksumCalculation: "WHEN_REQUIRED",
        credentials: { accessKeyId: env.MINIO_ACCESS_KEY, secretAccessKey: env.MINIO_SECRET_KEY },
      });
    }
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private configured(): S3Client {
    if (!this.client) {
      throw new ProblemException("STORAGE_NOT_CONFIGURED", 503, "Chưa cấu hình kho ảnh banner");
    }
    return this.client;
  }

  /** URL PUT có chữ ký: ràng buộc Content-Type và Content-Length đúng giá trị đã xác thực. */
  async presignUpload(
    key: string,
    contentType: BannerContentType,
    sizeBytes: number,
  ): Promise<PresignedUpload> {
    const client = this.configured();
    try {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: this.env.MINIO_BUCKET,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        {
          expiresIn: this.env.BANNER_PRESIGN_TTL_SECONDS,
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
      return { url, headers: { "Content-Type": contentType } };
    } catch {
      throw new ProblemException("STORAGE_UNAVAILABLE", 503, "Không tạo được link tải ảnh lên");
    }
  }

  /** Trả `null` nếu object chưa tồn tại; ngược lại kích thước, content-type và các byte đầu. */
  async inspect(key: string): Promise<StoredBanner | null> {
    const client = this.configured();
    const abortSignal = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: this.env.MINIO_BUCKET, Key: key }),
        { abortSignal },
      );
      const object = await client.send(
        new GetObjectCommand({
          Bucket: this.env.MINIO_BUCKET,
          Key: key,
          Range: `bytes=0-${BANNER_SNIFF_BYTES - 1}`,
        }),
        { abortSignal },
      );
      const bytes = object.Body
        ? Buffer.from(await object.Body.transformToByteArray())
        : Buffer.alloc(0);
      return { size: head.ContentLength ?? 0, contentType: head.ContentType, head: bytes };
    } catch (error) {
      if (isMissing(error)) return null;
      throw new ProblemException("STORAGE_UNAVAILABLE", 503, "Không kiểm tra được ảnh đã tải lên");
    }
  }

  /** Xóa object bị từ chối. Lỗi được nuốt vì object mồ côi không làm sai dữ liệu nghiệp vụ. */
  async remove(key: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.send(new DeleteObjectCommand({ Bucket: this.env.MINIO_BUCKET, Key: key }), {
        abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
    } catch {
      // Dọn mồ côi là best-effort; xem run report S-201b mục 9.
    }
  }
}
