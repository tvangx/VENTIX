import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventSchemas } from "@/lib/api";
import { uploadBanner } from "./banner-upload";
import { organizerApi } from "./tenant";

// Hook React Query cho API organizer của event-service. Lệnh ghi luôn kèm Idempotency-Key mới
// (mỗi lần bấm là một thao tác) và `version` của bản đang xem để server từ chối khi dữ liệu đã đổi.

type S = EventSchemas["schemas"];
export type OrgEvent = S["EventResponse"];
export type Venue = S["VenueResponse"];
export type TicketClass = S["TicketClassResponse"];
export type SalePhase = S["SalePhaseResponse"];
export type SeatMap = S["SeatMapResponse"];
export type EventStatus = OrgEvent["status"];

const key = () => ({ "Idempotency-Key": crypto.randomUUID() });

/** Lặp qua mọi trang (cursor) của một danh sách; danh sách của một sự kiện thường nhỏ. */
async function all<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; next_cursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const res = await page(cursor);
    items.push(...res.items);
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return items;
}

export const orgKeys = {
  all: (orgId: string) => ["organizer", orgId] as const,
  events: (orgId: string) => ["organizer", orgId, "events"] as const,
  venues: (orgId: string) => ["organizer", orgId, "venues"] as const,
  event: (orgId: string, eventId: string) => ["organizer", orgId, "event", eventId] as const,
};

export function useOrgEvents(orgId: string) {
  return useQuery({
    queryKey: orgKeys.events(orgId),
    queryFn: () => all((cursor) => organizerApi.get("/v1/organizer/events", { query: { cursor } })),
  });
}

export function useVenues(orgId: string) {
  return useQuery({
    queryKey: orgKeys.venues(orgId),
    queryFn: () => all((cursor) => organizerApi.get("/v1/organizer/venues", { query: { cursor } })),
  });
}

export interface EventBundle {
  event: OrgEvent;
  ticketClasses: TicketClass[];
  salePhases: SalePhase[];
  /** Seat map version mới nhất, null khi chưa có. */
  seatMap: SeatMap | null;
}

/** Sự kiện kèm hạng vé, đợt bán và seat map mới nhất: đủ cho mọi bước của wizard. */
export function useEventBundle(orgId: string, eventId: string | undefined) {
  return useQuery({
    queryKey: orgKeys.event(orgId, eventId ?? "new"),
    enabled: eventId !== undefined,
    queryFn: async (): Promise<EventBundle> => {
      const id = eventId ?? "";
      const [event, ticketClasses, salePhases, seatMaps] = await Promise.all([
        organizerApi.get("/v1/organizer/events/{id}", { path: { id } }),
        all((cursor) =>
          organizerApi.get("/v1/organizer/events/{eventId}/ticket-classes", {
            path: { eventId: id },
            query: { cursor },
          }),
        ),
        all((cursor) =>
          organizerApi.get("/v1/organizer/events/{eventId}/sale-phases", {
            path: { eventId: id },
            query: { cursor },
          }),
        ),
        all((cursor) =>
          organizerApi.get("/v1/organizer/events/{eventId}/seat-maps", {
            path: { eventId: id },
            query: { cursor },
          }),
        ),
      ]);
      const seatMap = seatMaps.reduce<SeatMap | null>(
        (latest, map) => (!latest || map.version > latest.version ? map : latest),
        null,
      );
      return {
        event,
        ticketClasses: [...ticketClasses].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        salePhases: [...salePhases].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
        seatMap,
      };
    },
  });
}

/** Mọi lệnh ghi xong thì tải lại dữ liệu của organizer (sự kiện, danh sách). */
function useInvalidate(orgId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: orgKeys.all(orgId) });
}

export function useCreateVenue(orgId: string) {
  const invalidate = useInvalidate(orgId);
  return useMutation({
    mutationFn: (body: S["CreateVenueDto"]) =>
      organizerApi.post("/v1/organizer/venues", { body, headers: key() }),
    onSuccess: invalidate,
  });
}

export function useSaveEvent(orgId: string) {
  const invalidate = useInvalidate(orgId);
  return useMutation({
    mutationFn: (
      input:
        { id: undefined; body: S["CreateEventDto"] } | { id: string; body: S["UpdateEventDto"] },
    ) =>
      input.id === undefined
        ? organizerApi.post("/v1/organizer/events", { body: input.body, headers: key() })
        : organizerApi.patch("/v1/organizer/events/{id}", {
            path: { id: input.id },
            body: input.body,
            headers: key(),
          }),
    onSuccess: invalidate,
  });
}

/** Tải banner (presign → PUT → confirm); confirm tự gắn `banner_key` và tăng `version`. */
export function useUploadBanner(orgId: string) {
  const invalidate = useInvalidate(orgId);
  return useMutation({
    mutationFn: (input: { eventId: string; file: File; version: number }) =>
      uploadBanner(input.eventId, input.file, input.version),
    onSuccess: invalidate,
  });
}

export function useTicketClassMutations(orgId: string, eventId: string) {
  const invalidate = useInvalidate(orgId);
  const create = useMutation({
    mutationFn: (body: S["CreateTicketClassDto"]) =>
      organizerApi.post("/v1/organizer/events/{eventId}/ticket-classes", {
        path: { eventId },
        body,
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["UpdateTicketClassDto"] }) =>
      organizerApi.patch("/v1/organizer/events/{eventId}/ticket-classes/{id}", {
        path: { eventId, id },
        body,
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      organizerApi.delete("/v1/organizer/events/{eventId}/ticket-classes/{id}", {
        path: { eventId, id },
        query: { version },
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useSalePhaseMutations(orgId: string, eventId: string) {
  const invalidate = useInvalidate(orgId);
  const create = useMutation({
    mutationFn: (body: S["CreateSalePhaseDto"]) =>
      organizerApi.post("/v1/organizer/events/{eventId}/sale-phases", {
        path: { eventId },
        body,
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: S["UpdateSalePhaseDto"] }) =>
      organizerApi.patch("/v1/organizer/events/{eventId}/sale-phases/{id}", {
        path: { eventId, id },
        body,
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      organizerApi.delete("/v1/organizer/events/{eventId}/sale-phases/{id}", {
        path: { eventId, id },
        query: { version },
        headers: key(),
      }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function useCreateSeatMap(orgId: string, eventId: string) {
  const invalidate = useInvalidate(orgId);
  return useMutation({
    mutationFn: (layout: S["SeatMapLayoutDto"]) =>
      organizerApi.post("/v1/organizer/events/{eventId}/seat-maps", {
        path: { eventId },
        body: { layout },
        headers: key(),
      }),
    onSuccess: invalidate,
  });
}

export function useSubmitEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidate(orgId);
  return useMutation({
    mutationFn: (version: number) =>
      organizerApi.post("/v1/organizer/events/{id}/submit", {
        path: { id: eventId },
        body: { version },
        headers: key(),
      }),
    onSuccess: invalidate,
  });
}

/** Chỉ sửa được khi DRAFT hoặc REJECTED (event-service: EVENT_NOT_EDITABLE). */
export function isEditable(status: EventStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: "Bản nháp",
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Bị từ chối",
  PUBLISHED: "Đã công khai",
  ENDED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};
