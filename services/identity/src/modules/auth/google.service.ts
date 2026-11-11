import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { ENV } from "../../app.tokens";
import type { Env } from "../../config/env.schema";
import { AuthService } from "./auth.service";
import { GoogleProvider } from "./google.provider";
import { GoogleRepository } from "./google.repository";

@Injectable()
export class GoogleService {
  constructor(
    private readonly repository: GoogleRepository,
    private readonly provider: GoogleProvider,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  async begin(linkUserId?: string) {
    this.provider.configured();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const cookie = `${state}.${verifier}.${nonce}`;
    await this.repository.createState(state, cookie, linkUserId);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return { cookie, authorization_url: url.toString() };
  }
  async complete(state: unknown, code: unknown, cookie: string) {
    const parsed = z
      .tuple([z.string().min(1).max(512), z.string().min(1).max(4096)])
      .safeParse([state, code]);
    const parts = cookie.split(".");
    if (!parsed.success || parts.length !== 3 || parts[0] !== state)
      throw new ProblemException(
        "OAUTH_STATE_INVALID",
        401,
        "OAuth state không hợp lệ hoặc đã dùng",
      );
    const stateRow = await this.repository.consumeState(parsed.data[0], cookie);
    if (!stateRow)
      throw new ProblemException(
        "OAUTH_STATE_INVALID",
        401,
        "OAuth state không hợp lệ hoặc đã dùng",
      );
    const profile = await this.provider.exchange(parsed.data[1], parts[1], parts[2]);
    return this.auth.startSession(await this.repository.resolve(profile, stateRow.linkUserId));
  }
}
