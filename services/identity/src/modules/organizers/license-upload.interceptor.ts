import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type { Request, Response } from "express";
import multer, { MulterError } from "multer";
import { Observable } from "rxjs";
import { MAX_DOCUMENT_BYTES } from "./documents.storage";

/** Dùng parser đã vá riêng cho Identity; không override dependency của service khác. */
@Injectable()
export class LicenseUploadInterceptor implements NestInterceptor {
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_DOCUMENT_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
      fieldNameSize: 64,
      fieldSize: 128,
    },
  }).single("file");
  async intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    await new Promise<void>((resolve, reject) =>
      this.upload(req, res, (error: unknown) => {
        if (!error) {
          resolve();
          return;
        }
        const status = error instanceof MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        reject(
          new ProblemException(
            "INVALID_UPLOAD",
            status,
            "Multipart không hợp lệ hoặc file vượt giới hạn 1 MiB",
          ),
        );
      }),
    );
    return next.handle();
  }
}
