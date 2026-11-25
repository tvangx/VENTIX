import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/catalog/format";
import { isEditable, STATUS_LABEL, useOrgEvents } from "@/lib/organizer/api";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { useOrganizer } from "./organizer-context";

/** Danh sách sự kiện của ban tổ chức, mới sửa gần nhất lên đầu. */
export function OrganizerEventsPage() {
  const { organizerId } = useOrganizer();
  const events = useOrgEvents(organizerId);
  const items = [...(events.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <section className="flex max-w-5xl flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-5xl leading-[0.9] font-extrabold tracking-[-0.05em] md:text-[60px]">
          Sự kiện <span className="font-serif font-medium text-emphasis italic">của bạn</span>
        </h1>
        <Button asChild size="lg">
          <Link to="/organizer/events/new">+ Tạo sự kiện</Link>
        </Button>
      </div>

      {events.isPending ? <p role="status">Đang tải sự kiện…</p> : null}
      {events.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="m-0 font-bold">{organizerErrorMessage(events.error)}</p>
          <Button variant="outline" onClick={() => void events.refetch()}>
            Thử lại
          </Button>
        </div>
      ) : null}
      {events.data && items.length === 0 ? (
        <p className="m-0 text-lg">Chưa có sự kiện nào. Bấm “Tạo sự kiện” để bắt đầu.</p>
      ) : null}

      {items.length > 0 ? (
        <ul aria-label="Danh sách sự kiện" className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-4 bg-card px-5 py-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <b className="text-xl break-words">{event.title}</b>
                <span className="text-[15px] text-muted-foreground">
                  {formatDateTime(event.start_at)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-accent px-3 py-1 text-sm font-bold text-accent-foreground">
                  {STATUS_LABEL[event.status]}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/organizer/events/${event.id}`} aria-label={`Mở ${event.title}`}>
                    {isEditable(event.status) ? "Tiếp tục" : "Xem"}
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
