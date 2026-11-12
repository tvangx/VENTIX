import { Inject, Injectable } from "@nestjs/common";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { TicketSecrets } from "../tickets/ticket-secrets";

@Injectable()
export class OfflineKeys extends TicketSecrets {
  constructor(@Inject(ENV) env: Env) {
    super(
      env.TICKET_ENCRYPTION_KEYS ?? {},
      env.TICKET_ACTIVE_KEY_ID ?? "",
      "ticket-offline-device-v1",
    );
  }
}
