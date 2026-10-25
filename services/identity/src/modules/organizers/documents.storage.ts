import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { Client } from "minio";
import { AsyncLocalStorage } from "node:async_hooks";
import * as http from "node:http";
import * as https from "node:https";
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
export class DocumentsStorage {
  private readonly client?: Client;
  private readonly signals = new AsyncLocalStorage<AbortSignal>();
  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.MINIO_ACCESS_KEY && env.MINIO_SECRET_KEY) {
      const endpoint = new URL(env.MINIO_ENDPOINT);
      const transport = endpoint.protocol === "https:" ? https : http;
      this.client = new Client({
        endPoint: endpoint.hostname,
        port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
        useSSL: endpoint.protocol === "https:",
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
        // SDK chỉ dùng overload request(options, callback); signal hủy I/O cả khi SDK retry.
        transport: {
          request: ((
            options: http.RequestOptions,
            callback: (response: http.IncomingMessage) => void,
          ) =>
            transport.request(
              { ...options, signal: this.signals.getStore() },
              callback,
            )) as typeof http.request,
        },
      });
    }
  }
  private configured(): Client {
    if (!this.client)
      throw new ProblemException("STORAGE_NOT_CONFIGURED", 503, "Chưa cấu hình kho giấy phép");
    return this.client;
  }
  async put(key: string, file: LicenseFile): Promise<void> {
    const client = this.configured();
    try {
      await this.signals.run(AbortSignal.timeout(5000), () =>
        client.putObject(this.env.MINIO_BUCKET, key, file.buffer, file.buffer.length, {
          "Content-Type": file.mimetype,
        }),
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
      return await this.signals.run(AbortSignal.timeout(5000), () =>
        client.presignedGetObject(this.env.MINIO_BUCKET, key, 60, {
          "response-content-disposition": "attachment",
        }),
      );
    } catch {
      throw new ProblemException("STORAGE_UNAVAILABLE", 503, "Không tạo được link tải giấy phép");
    }
  }
}
