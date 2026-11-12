import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import nodemailer, { Transporter } from "nodemailer";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";

@Injectable()
export class KycMailer {
  private readonly transport: Transporter;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = nodemailer.createTransport({
      host: env.KYC_SMTP_HOST,
      port: env.KYC_SMTP_PORT,
      secure: env.KYC_SMTP_SECURE === "true",
      requireTLS: env.KYC_SMTP_REQUIRE_TLS === "true",
      auth: env.KYC_SMTP_USER
        ? { user: env.KYC_SMTP_USER, pass: env.KYC_SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      dnsTimeout: 3000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  async send(email: string, code: string): Promise<void> {
    try {
      const result = await this.transport.sendMail({
        from: this.env.KYC_SMTP_FROM,
        to: email,
        subject: "VENTIX - Mã xác minh KYC",
        text: `Mã xác minh KYC của bạn là ${code}. Mã hết hạn sau ${this.env.KYC_OTP_TTL_SECONDS} giây. Không chia sẻ mã này.`,
      });
      if ((result.rejected?.length ?? 0) > 0 || result.accepted?.length !== 1)
        throw new Error("RECIPIENT_REJECTED");
    } catch {
      throw new ProblemException("OTP_DELIVERY_UNAVAILABLE", 503, "Chưa gửi được mã xác minh");
    }
  }
}
