import { Injectable } from "@nestjs/common";
import { AuthUser, assertSameOrganizer } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { FinanceRepository } from "../finance.repository";

@Injectable()
export class StatsService {
  constructor(private readonly repo: FinanceRepository) {}
  async get(eventId: string, user: AuthUser) {
    return this.repo.db.transaction(async (exec) => {
      // Cùng một snapshot cho tenant và cả hai read-model, kể cả khi đang hoàn tiền.
      await exec.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const [event] = await exec.query<{ organizer_id: string; title: string }>(
        "SELECT organizer_id,title FROM events_ref WHERE event_id=$1::uuid",
        [eventId],
      );
      if (!event)
        throw new ProblemException("EVENT_NOT_FOUND", 404, "Sự kiện chưa có trong finance");
      if (!user.roles.includes("ADMIN")) assertSameOrganizer(user, event.organizer_id);
      const sales = await exec.query(
        "SELECT ticket_class_id,sold,revenue_vnd::text FROM event_sales_stats WHERE event_id=$1::uuid ORDER BY ticket_class_id",
        [eventId],
      );
      const revenue = await exec.query(
        "SELECT category,gross_vnd::text,net_vnd::text,vat_vnd::text FROM event_revenue_stats WHERE event_id=$1::uuid ORDER BY category",
        [eventId],
      );
      return { event_id: eventId, title: event.title, sales, revenue };
    });
  }
}
