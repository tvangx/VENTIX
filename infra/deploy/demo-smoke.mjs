// Only synthetic local fixtures. Never use this signed IPN fixture against EC2.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

assert.equal(
  process.env.T208_SYNTHETIC_LOCAL,
  "true",
  "Requires explicit isolated local fixture mode",
);
const origin = "http://kong:8000";
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
async function request(path, options = {}) {
  const res = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}
async function poll(run, label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const result = await run();
    if (result) return result;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error(`Timeout: ${label}`);
}
for (const path of ["/", "/login", "/events/a2050000-0000-4000-8000-000000000101/seats"]) {
  const { res, body } = await request(path);
  check(res.status === 200 && body.includes('<div id="root">'), `SPA ${path}`);
}
for (const path of [
  "/api/unknown/v1/events",
  "/mockServiceWorker.js",
  "/.env",
  "/api/event/v1/internal/events/x/seat-classes",
  "/v1/internal/test",
  "/api/booking/V1/Internal/test",
]) {
  check((await request(path)).res.status === 404, `Blocked ${path}`);
}
check((await request("/api/ticket/v1/tickets")).res.status === 401, "Ticket requires JWT");
check(
  (await request("/api/payment/v1/payments/vnpay/ipn")).body.RspCode === "97",
  "Invalid IPN signature rejected",
);
check(
  (await request("/api/payment/v1/payments/vnpay/return")).body.signature_valid === false,
  "Invalid Return signature rejected",
);
const credentials = {
  email: `t208-${randomUUID()}@example.test`,
  password: "Synthetic-Local-Password-208!",
};
const jsonHeaders = { "Content-Type": "application/json", Origin: "https://ventixxx.dpdns.org" };
const registerOptions = {
  method: "POST",
  headers: { ...jsonHeaders, "Idempotency-Key": randomUUID() },
  body: JSON.stringify(credentials),
};
const registered = await request("/api/identity/v1/auth/register", registerOptions);
check(registered.res.status === 201, `Register: ${registered.res.status}`);
check(
  (await request("/api/identity/v1/auth/register", registerOptions)).body.id === registered.body.id,
  "Register idempotency",
);
const login = await request("/api/identity/v1/auth/login", {
  method: "POST",
  headers: jsonHeaders,
  body: JSON.stringify(credentials),
});
check(login.res.status === 200 && login.body.access_token, "Real password login");
const cookie = login.res.headers.get("set-cookie");
check(cookie.includes("HttpOnly") && cookie.includes("Secure"), "Production cookie flags");
const refresh = await request("/api/identity/v1/auth/refresh", {
  method: "POST",
  headers: { ...jsonHeaders, Cookie: cookie.split(";")[0] },
});
check(refresh.res.status === 200 && refresh.body.access_token, "Refresh through gateway");
const auth = { ...jsonHeaders, Authorization: `Bearer ${refresh.body.access_token}` };
const eventId = "a2050000-0000-4000-8000-000000000101";
const detail = await request(`/api/event/v1/events/${eventId}`);
check(detail.res.status === 200 && detail.body.seat_map, "Real public event and seat map");
check((await request("/api/event/v1/events")).body.items.length >= 3, "Seeded catalog");
const seatsRes = await request(
  `/api/event/v1/events/${eventId}/seats?seat_map_version=${detail.body.seat_map.version}&limit=1000`,
);
check(seatsRes.res.ok, "Public seat UUID mapping via Kong");
const availability = await request(`/api/booking/v1/events/${eventId}/seat-status`, {
  headers: auth,
});
check(availability.res.ok, "Current availability before selecting a fixture seat");
const occupied = new Set([...availability.body.sold, ...availability.body.held]);
const seat = seatsRes.body.items.find((item) => !occupied.has(item.seat_id))?.seat_id;
check(seat, "A free fixture seat is required; preserve previous test orders/tickets");
const joinOptions = { method: "POST", headers: auth, body: JSON.stringify({ event_id: eventId }) };
await poll(
  async () => (await request("/api/booking/v1/queue/join", joinOptions)).res.status === 201,
  "Event lifecycle consumed",
);
const stream = await fetch(`${origin}/api/booking/v1/queue/status?event_id=${eventId}`, {
  headers: auth,
  signal: AbortSignal.timeout(15000),
});
check(
  stream.ok && stream.headers.get("content-type").includes("text/event-stream"),
  "Queue SSE through Kong",
);
const reader = stream.body.getReader();
let buffer = "";
let admission;
while (!admission) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += new TextDecoder().decode(value);
  for (const line of buffer.split("\n"))
    if (line.startsWith("data:")) {
      try {
        admission = JSON.parse(line.slice(5)).admission_token;
      } catch {
        /* partial SSE frame */
      }
    }
}
await reader.cancel();
check(admission, "Waiting Room issues admission token");
const admitted = { ...auth, "X-Admission-Token": admission };
const seatStream = await fetch(`${origin}/api/booking/v1/events/${eventId}/seat-stream`, {
  headers: admitted,
  signal: AbortSignal.timeout(10000),
});
const seatReader = seatStream.body.getReader();
const firstFrame = await seatReader.read();
check(
  seatStream.ok && new TextDecoder().decode(firstFrame.value).includes("snapshot"),
  "Seat SSE initial frame without buffering",
);
await seatReader.cancel();
const holdBody = JSON.stringify({ event_id: eventId, seat_ids: [seat] });
check(
  (await request("/api/booking/v1/holds", { method: "POST", headers: auth, body: holdBody })).res
    .status === 403,
  "Admission enforced",
);
check(
  (await request("/api/booking/v1/holds", { method: "POST", headers: admitted, body: holdBody }))
    .res.status === 201,
  "Real Redis seat hold",
);
const checkoutOptions = {
  method: "POST",
  headers: { ...admitted, "Idempotency-Key": randomUUID() },
  body: JSON.stringify({ event_id: eventId, seat_ids: [seat], ga_items: [], merch_items: [] }),
};
const order = await poll(async () => {
  const result = await request("/api/booking/v1/checkout", checkoutOptions);
  if (result.res.status === 503) return null;
  check(result.res.status === 201, `Checkout: ${result.res.status}, ${result.body.code ?? ""}`);
  return result.body;
}, "Pricing prefetch");
check(
  (await request("/api/booking/v1/checkout", checkoutOptions)).body.order_id === order.order_id,
  "Checkout replay",
);
const readOrder = await request(`/api/booking/v1/orders/${order.order_id}`, { headers: auth });
check(
  readOrder.res.ok && readOrder.body.status === "AWAITING_PAYMENT",
  "Owner reads actual order state",
);
check(
  (await request(`/api/booking/v1/orders/${order.order_id}`)).res.status === 401,
  "Order read requires JWT",
);
const payOptions = {
  method: "POST",
  headers: { ...auth, "Idempotency-Key": randomUUID() },
  body: JSON.stringify({ order_id: order.order_id, provider: "VNPAY" }),
};
const payment = await poll(async () => {
  const result = await request("/api/payment/v1/payments", payOptions);
  if (result.res.status === 409 && result.body.code === "ORDER_NOT_READY") return null;
  check(result.res.status === 201, `Payment create: ${result.res.status}`);
  return result.body;
}, "Payable consumer");
const redirect = new URL(payment.redirect_url);
check(
  redirect.origin === "https://sandbox.vnpaytest.vn",
  "Only sandbox redirect; not opening provider",
);
check(
  redirect.searchParams.get("vnp_ReturnUrl") === "https://ventixxx.dpdns.org/payments/return",
  "Return route preserved",
);
check(
  (await request("/api/payment/v1/payments", payOptions)).body.redirect_url ===
    payment.redirect_url,
  "Payment replay",
);
// Synthetic callback validates distributed wiring, NOT an actual VNPay sandbox payment.
const params = {
  vnp_TmnCode: "TEST208X",
  vnp_TxnRef: redirect.searchParams.get("vnp_TxnRef"),
  vnp_Amount: redirect.searchParams.get("vnp_Amount"),
  vnp_BankCode: "NCB",
  vnp_OrderInfo: "T208 synthetic local fixture",
  vnp_TransactionNo: String(Date.now()),
  vnp_ResponseCode: "00",
  vnp_TransactionStatus: "00",
};
const encode = (value) => encodeURIComponent(value).replace(/%20/g, "+");
const query = Object.keys(params)
  .sort()
  .map((key) => `${encode(key)}=${encode(params[key])}`)
  .join("&");
const signed =
  query +
  "&vnp_SecureHash=" +
  createHmac("sha512", "t208-synthetic-test-not-a-merchant-secret").update(query).digest("hex");
check(
  (await request("/api/payment/v1/payments/vnpay/ipn?" + signed)).body.RspCode === "00",
  "Synthetic signed IPN accepted",
);
check(
  (await request("/api/payment/v1/payments/vnpay/ipn?" + signed)).body.RspCode === "02",
  "Duplicate IPN rejected as already confirmed",
);
const ticket = await poll(
  async () =>
    (await request("/api/ticket/v1/tickets", { headers: auth })).body.items?.find(
      (item) => item.order_id === order.order_id,
    ),
  "Kafka OrderConfirmed to Ticket",
);
check(ticket.status === "ACTIVE" && ticket.seat_id === seat, "Ticket issued for held seat");
const token = await request(`/api/ticket/v1/tickets/${ticket.id}/token`, { headers: auth });
check(
  token.res.status === 200 && /^\d{6}$/.test(token.body.token) && token.body.qr_payload,
  "Real encrypted ticket/TOTP/QR API",
);
process.stdout.write(
  `PASS ${checks} local HTTP/SSE/saga checks. Synthetic signed IPN only; actual VNPay sandbox/EC2 not tested.\n`,
);
