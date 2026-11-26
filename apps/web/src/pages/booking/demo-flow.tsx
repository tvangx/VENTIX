import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/http/client";
import { useAuthStore } from "@/lib/http/auth-store";
import { useEventDetail } from "@/lib/catalog/queries";
import { parseLayout } from "@/lib/seatmap/layout";
import { toProblem } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Seat {
  seat_id: string;
  ticket_class_id: string;
  zone_name: string;
  block_name: string;
  row_label: string;
  seat_no: number;
}
interface SeatPage {
  items: Seat[];
  next_cursor: string | null;
}
interface Order {
  order_id: string;
  event_id: string;
  status: string;
  total_amount_vnd: number;
  expires_at: string;
}
interface Ticket {
  id: string;
  order_id: string;
  status: string;
  seat_id: string | null;
}
const money = (value: number) => value.toLocaleString("vi-VN") + " ₫";
function useAccount(): string {
  return useAuthStore((state) => {
    try {
      return String(
        (
          JSON.parse(
            atob((state.accessToken ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ) as { sub?: string }
        ).sub ?? "anonymous",
      );
    } catch {
      return "anonymous";
    }
  });
}
const message = (error: unknown) =>
  toProblem(error)?.detail ?? "Không kết nối được dịch vụ. Thử lại bằng nút bên dưới.";
function paymentUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https://sandbox.vnpaytest.vn", "https://sandbox.vnpayment.vn"].includes(url.origin) ||
    url.pathname !== "/paymentv2/vpcpay.html" ||
    url.username ||
    url.password
  )
    throw new Error("Invalid sandbox redirect");
  return url.href;
}
function stableKey(scope: string): string {
  let key = sessionStorage.getItem(scope);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(scope, key);
  }
  return key;
}
async function admission(eventId: string, signal: AbortSignal): Promise<string | undefined> {
  const joined = await apiClient.post<{ status: string; admission_token?: string }>(
    "/booking/v1/queue/join",
    { event_id: eventId },
    { signal },
  );
  if (joined.data.status === "disabled" || joined.data.admission_token)
    return joined.data.admission_token;
  const token = useAuthStore.getState().accessToken;
  const res = await fetch(`/api/booking/v1/queue/status?event_id=${eventId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    credentials: "include",
  });
  if (!res.ok || !res.body) throw new Error("Queue unavailable");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data: unknown = JSON.parse(line.slice(5));
          if (
            typeof data === "object" &&
            data !== null &&
            "admission_token" in data &&
            typeof data.admission_token === "string"
          )
            return data.admission_token;
          if (typeof data === "object" && data !== null && "code" in data)
            throw new Error("Queue error");
        }
      }
    }
  } finally {
    await reader.cancel();
  }
  throw new Error("Queue closed before admission");
}
export function BuyPage() {
  const account = useAccount();
  const { id = "" } = useParams();
  const detail = useEventDetail(id);
  const location = useLocation();
  const [selection, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const queue = useQuery({
    queryKey: ["admission", account, id],
    queryFn: async ({ signal }) => ({ token: await admission(id, signal), ready: true }),
    retry: false,
    staleTime: 240000,
  });
  const grant = queue.data ?? { ready: false, token: undefined };
  const version = detail.data?.seat_map?.version;
  const seats = useQuery({
    queryKey: ["public-seats", id, version],
    enabled: !!version,
    queryFn: async ({ signal }) => {
      const all: Seat[] = [];
      let cursor: string | null = null;
      do {
        const { data }: { data: SeatPage } = await apiClient.get(`/event/v1/events/${id}/seats`, {
          params: { seat_map_version: version, limit: 5000, ...(cursor ? { cursor } : {}) },
          signal,
        });
        all.push(...data.items);
        cursor = data.next_cursor;
      } while (cursor);
      return all;
    },
  });
  const selected =
    selection ??
    (() => {
      if (!seats.data || !detail.data) return [];
      const keys: unknown = (location.state as { keys?: unknown } | null)?.keys;
      const layout = parseLayout(detail.data.seat_map?.layout);
      if (!Array.isArray(keys) || !layout) return [];
      return seats.data
        .filter((s) => {
          const z = layout.zones.findIndex((v) => v.name === s.zone_name);
          const b = layout.zones[z]?.blocks.findIndex((v) => v.name === s.block_name);
          const r =
            b === undefined
              ? -1
              : layout.zones[z]?.blocks[b]?.rows.findIndex((v) => v.label === s.row_label);
          return keys.includes(`${z}:${b}:${r}:${s.seat_no}`);
        })
        .map((s) => s.seat_id);
    })();
  const status = useQuery({
    queryKey: ["seat-status", id],
    queryFn: async () =>
      (
        await apiClient.get<{ sold: string[]; held: string[] }>(
          `/booking/v1/events/${id}/seat-status`,
        )
      ).data,
    refetchInterval: 2000,
  });
  const unavailable = new Set([...(status.data?.sold ?? []), ...(status.data?.held ?? [])]);
  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const ids = [...selected].sort();
      const scope = `ventix:checkout:${account}:${id}:${ids.join(",")}`;
      const key = stableKey(scope);
      const headers = grant.token ? { "X-Admission-Token": grant.token } : {};
      await apiClient.post("/booking/v1/holds", { event_id: id, seat_ids: ids }, { headers });
      const { data } = await apiClient.post<Order>(
        "/booking/v1/checkout",
        { event_id: id, seat_ids: ids, ga_items: [], merch_items: [] },
        { headers: { ...headers, "Idempotency-Key": key } },
      );
      sessionStorage.setItem("ventix:last-order", data.order_id);
      sessionStorage.removeItem(scope);
      window.location.assign(`/orders/${data.order_id}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-5 py-10">
      <h1 className="text-3xl font-bold">Giữ ghế · {detail.data?.title}</h1>
      <p>{grant.ready ? "Đã được phép đặt vé." : "Đang chờ cấp lượt đặt vé…"}</p>
      {(error || seats.isError || queue.isError) && (
        <p role="alert">{error || message(seats.error ?? queue.error)}</p>
      )}
      <Button onClick={() => void queue.refetch()} disabled={busy}>
        Vào lại phòng chờ
      </Button>
      {!version ? (
        <p>Sự kiện chưa có sơ đồ ghế đánh số.</p>
      ) : (
        <label className="block">
          Chọn ghế (giữ Ctrl/Command để chọn nhiều)
          <select
            aria-label="Ghế"
            multiple
            size={10}
            className="block w-full rounded border p-3"
            value={selected}
            onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {seats.data?.map((s) => (
              <option
                key={s.seat_id}
                value={s.seat_id}
                disabled={unavailable.has(s.seat_id) && !selected.includes(s.seat_id)}
              >
                {s.zone_name} · {s.block_name} · {s.row_label}/{s.seat_no}
                {unavailable.has(s.seat_id) ? " (đang giữ/đã bán)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>Chọn {selected.length} ghế. Giá và giới hạn được backend kiểm tra khi tạo đơn.</p>
      <Button
        disabled={busy || !grant.ready || !selected.length || seats.isPending || status.isError}
        onClick={() => void checkout()}
      >
        {busy ? "Đang giữ ghế/tạo đơn…" : "Giữ ghế và tạo đơn"}
      </Button>
    </main>
  );
}
export function OrderPage({ returned = false }: { returned?: boolean }) {
  const account = useAccount();
  const params = useParams();
  const id = params.orderId ?? sessionStorage.getItem("ventix:last-order");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const order = useQuery({
    queryKey: ["order", account, id],
    enabled: !!id,
    queryFn: async () => (await apiClient.get<Order>(`/booking/v1/orders/${id}`)).data,
    refetchInterval: (query) =>
      query.state.data &&
      ["CONFIRMED", "EXPIRED", "CANCELLED", "FAILED", "REFUNDED", "REFUND_REQUIRED"].includes(
        query.state.data.status,
      )
        ? false
        : 2000,
  });
  async function pay() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await apiClient.post<{ redirect_url: string }>(
        "/payment/v1/payments",
        { order_id: id, provider: "VNPAY" },
        { headers: { "Idempotency-Key": stableKey(`ventix:payment:${id}`) } },
      );
      sessionStorage.setItem("ventix:last-order", id);
      window.location.assign(paymentUrl(data.redirect_url));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-5 py-10">
      <h1 className="text-3xl font-bold">{returned ? "Kết quả thanh toán" : "Đơn vé của bạn"}</h1>
      {returned && (
        <p>Đang đối chiếu kết quả từ hệ thống. Tham số trên URL không xác nhận thanh toán.</p>
      )}
      {!id && (
        <p>
          Không tìm thấy mã đơn trong trình duyệt này.{" "}
          <Link to="/tickets">Kiểm tra vé của tôi</Link>.
        </p>
      )}
      {order.isPending && id && <p role="status">Đang đọc trạng thái đơn…</p>}
      {order.isError && <p role="alert">{message(order.error)}</p>}
      {order.data && (
        <>
          <p>Mã đơn: {id}</p>
          <p role="status">Trạng thái: {order.data.status}</p>
          <p>Tổng tiền: {money(order.data.total_amount_vnd)}</p>
          <p>Hạn thanh toán: {new Date(order.data.expires_at).toLocaleString("vi-VN")}</p>
          {order.data.status === "CONFIRMED" ? (
            <Link to="/tickets">Xem vé đã phát hành</Link>
          ) : (
            order.data.status === "AWAITING_PAYMENT" && (
              <>
                <p>
                  {returned
                    ? "Chưa nhận được xác nhận IPN. Có thể tải lại để kiểm tra; đừng thanh toán lại khi giao dịch đang xử lý."
                    : "Thanh toán qua VNPay sandbox."}
                </p>
                {!returned && (
                  <Button disabled={busy} onClick={() => void pay()}>
                    {busy ? "Đang tạo thanh toán…" : "Thanh toán VNPay sandbox"}
                  </Button>
                )}
              </>
            )
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Button onClick={() => void order.refetch()}>Kiểm tra lại</Button>
    </main>
  );
}
export function TicketsPage() {
  const account = useAccount();
  const tickets = useQuery({
    queryKey: ["my-tickets", account],
    queryFn: async () =>
      (
        await apiClient.get<{ items: Ticket[]; next_cursor: string | null }>("/ticket/v1/tickets", {
          params: { limit: 100 },
        })
      ).data,
    refetchInterval: 5000,
  });
  const [active, setActive] = useState<string>();
  const qr = useQuery({
    queryKey: ["ticket-token", account, active],
    enabled: !!active,
    queryFn: async () =>
      (
        await apiClient.get<{ token: string; qr_payload: string; expires_at: string }>(
          `/ticket/v1/tickets/${active}/token`,
        )
      ).data,
    refetchInterval: 15000,
  });
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-5 py-10">
      <h1 className="text-3xl font-bold">Vé của tôi</h1>
      {tickets.isPending && <p>Đang tải vé…</p>}
      {tickets.isError && <p role="alert">{message(tickets.error)}</p>}
      {tickets.data?.items.length === 0 && (
        <p>Chưa có vé được phát hành. Hệ thống có thể đang xử lý sau IPN.</p>
      )}
      {tickets.data?.items.map((t) => (
        <article className="space-y-2 rounded border p-4" key={t.id}>
          <p>Vé {t.id}</p>
          <p>
            Đơn {t.order_id} · {t.status}
          </p>
          <Button disabled={t.status !== "ACTIVE"} onClick={() => setActive(t.id)}>
            Xem mã vé
          </Button>
        </article>
      ))}
      {qr.isError && <p role="alert">{message(qr.error)}</p>}
      {qr.data && (
        <section>
          <h2>Mã vé hiện tại</h2>
          <strong className="text-4xl">{qr.data.token}</strong>
          <p>Hết hạn {new Date(qr.data.expires_at).toLocaleTimeString("vi-VN")}</p>
          <pre className="whitespace-pre-wrap break-all">{qr.data.qr_payload}</pre>
        </section>
      )}
    </main>
  );
}
