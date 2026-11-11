import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";

export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export interface LicenseFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export function licenseExtension(file?: LicenseFile): string {
  if (!file || file.buffer.length === 0 || file.buffer.length > MAX_DOCUMENT_BYTES)
    throw new ProblemException("INVALID_DOCUMENT", 400, "Cần file giấy phép, tối đa 1 MiB");
  const b = file.buffer;
  if (file.mimetype === "application/pdf" && b.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (
    file.mimetype === "image/png" &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (file.mimetype === "image/jpeg" && b.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    return "jpg";
  throw new ProblemException(
    "INVALID_DOCUMENT_TYPE",
    400,
    "Chỉ nhận PDF, PNG hoặc JPEG đúng định dạng",
  );
}

@Injectable()
export class DocumentsStorage implements OnModuleDestroy {
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
    if (!this.client)
      throw new ProblemException("STORAGE_NOT_CONFIGURED", 503, "Chưa cấu hình kho giấy phép");
    return this.client;
  }
  async put(key: string, file: LicenseFile): Promise<void> {
    const client = this.configured();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.env.MINIO_BUCKET,
          Key: key,
          Body: file.buffer,
          ContentLength: file.buffer.length,
          ContentType: file.mimetype,
        }),
        { abortSignal: AbortSignal.timeout(5000) },
      );
    } catch {
      throw new ProblemException(
        "STORAGE_UNAVAILABLE",
        503,
        "Không lưu được giấy phép, hãy thử lại với cùng key",
      );
    }
  }
  async download(key: string): Promise<string> {
    const client = this.configured();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: this.env.MINIO_BUCKET,
          Key: key,
          ResponseContentDisposition: "attachment",
        }),
        { expiresIn: 60 },
      );
    } catch {
      throw new ProblemException("STORAGE_UNAVAILABLE", 503, "Không tạo được link tải giấy phép");
    }
  }
}
