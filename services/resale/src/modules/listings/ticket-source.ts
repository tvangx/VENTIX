import { Inject, Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";

const ticketSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  status: z.string(),
  unit_price_vnd: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .max(19),
});
const pageSchema = z.object({
  items: z.array(ticketSchema).max(100),
  next_cursor: z.string().uuid().nullable(),
});

@Injectable()
export class TicketSource {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async owned(ticketId: string, authorization: string): Promise<z.infer<typeof ticketSchema>> {
    let cursor: string | null = null;
    const seen = new Set<string>();
    const signal = AbortSignal.timeout(2000);
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const url = new URL("/v1/tickets", this.env.TICKET_SERVICE_URL);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      let page: z.infer<typeof pageSchema>;
      try {
        const response = await fetch(url, {
          headers: { Authorization: authorization },
          redirect: "error",
          signal,
        });
        if (response.status === 401 || response.status === 403)
          throw new ProblemException("UNAUTHORIZED", 401, "Phiên xác thực vé không hợp lệ");
        if (!response.ok) throw new Error("TICKET_LOOKUP_FAILED");
        page = pageSchema.parse(await response.json());
      } catch (error) {
        if (error instanceof ProblemException) throw error;
        throw new ProblemException("TICKET_SERVICE_UNAVAILABLE", 503, "Dịch vụ vé chưa sẵn sàng");
      }
      const ticket = page.items.find((item) => item.id === ticketId);
      if (ticket) return ticket;
      if (!page.next_cursor)
        throw new ProblemException("TICKET_NOT_FOUND", 404, "Không tìm thấy vé thuộc sở hữu");
      if (seen.has(page.next_cursor)) break;
      seen.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    throw new ProblemException("TICKET_SERVICE_UNAVAILABLE", 503, "Không hoàn tất được tra cứu vé");
  }
}
