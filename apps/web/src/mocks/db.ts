import type { BookingSchemas, FinanceSchemas, IdentitySchemas } from "@/lib/api";
import { initialOrganizerState, type OrganizerMockState } from "./organizer-store";
import { seedEvents, seedMerch, type SeedEvent, type SeedSalePhase } from "./seed";

// Trạng thái giả lập của backend cho MSW: chỉ nằm trong bộ nhớ trình duyệt/tiến trình test.
// Không phải nguồn sự thật nào; tải lại trang thì mất (trừ phiên đăng nhập và tài khoản, xem persist).

export const DEMO_PASSWORD = "ventix-demo-2026";
export const DEMO_ORGANIZER_ID = "10000000-0000-4000-8000-000000000001";
export const DEMO_USERS = {
  user: { id: "00000000-0000-4000-8000-0000000000a1", email: "user@ventix.test" },
  organizer: { id: "00000000-0000-4000-8000-0000000000a2", email: "organizer@ventix.test" },
  staff: { id: "00000000-0000-4000-8000-0000000000a3", email: "staff@ventix.test" },
  admin: { id: "00000000-0000-4000-8000-0000000000a4", email: "admin@ventix.test" },
  google: { id: "00000000-0000-4000-8000-0000000000a5", email: "google.user@ventix.test" },
} as const;

/** Thời gian sống của access token mock, khớp identity (900 giây). */
export const ACCESS_TOKEN_TTL_SEC = 900;
/** TTL giữ ghế 10 phút (plan T-202). */
export const HOLD_TTL_MS = 10 * 60 * 1000;
/** Đơn chờ thanh toán; con số chỉ dùng cho mock. */
export const ORDER_TTL_MS = 15 * 60 * 1000;
/** VAT 10%: giả định phát triển của ADR-0012, giá đã gồm VAT. */
const VAT_RATE_BPS = 1000n;

type Membership = IdentitySchemas["schemas"]["MembershipDto"];
type Application = IdentitySchemas["schemas"]["ApplicationResponseDto"];
type DocumentMeta = IdentitySchemas["schemas"]["DocumentResponseDto"];
type DeadLetterRow = FinanceSchemas["schemas"]["DeadLetterRow"];
type AuditRow = FinanceSchemas["schemas"]["AuditRow"];

export interface MockUser {
  id: string;
  email: string;
  password: string | null;
  roles: string[];
  memberships: Membership[];
}

export interface AccessGrant {
  userId: string;
  organizerId: string | null;
  expiresAt: number;
}

export interface MockSeat {
  id: string;
  ticket_class_id: string;
}

export interface MockOrder {
  id: string;
  user_id: string;
  event_id: string;
  seat_ids: string[];
  ga_items: BookingSchemas["schemas"]["GaItemDto"][];
  merch_items: BookingSchemas["schemas"]["MerchItemDto"][];
  status: "AWAITING_PAYMENT" | "PAID";
  ticket_amount_vnd: number;
  merch_amount_vnd: number;
  total_amount_vnd: number;
  expires_at: string;
}

export interface IdempotentEntry {
  fingerprint: string;
  body: unknown;
}

export type SeatDelta = `${"H" | "A" | "S"}:${string}`;
type SeatListener = (deltas: SeatDelta[]) => void;

interface MockState {
  users: Map<string, MockUser>;
  tokens: Map<string, AccessGrant>;
  /** Thay cho cookie HttpOnly ventix_refresh: mock chỉ có một trình duyệt. */
  refreshUserId: string | null;
  idempotency: Map<string, IdempotentEntry>;
  applications: Map<string, Application>;
  documents: Map<string, DocumentMeta[]>;
  holds: Map<string, Map<string, { userId: string; expiresAt: number }>>;
  sold: Map<string, Set<string>>;
  orders: Map<string, MockOrder>;
  payments: Map<string, { orderId: string; amount: number }>;
  queues: Map<string, string[]>;
  admissions: Map<string, { userId: string; eventId: string; expiresAt: number }>;
  dlq: DeadLetterRow[];
  audit: AuditRow[];
  /** API organizer của event-service (V-203). */
  organizer: OrganizerMockState;
}

export const mockConfig = {
  /** Nhịp đẩy vị trí hàng chờ (thật: 1 giây). Test đặt nhỏ để chạy nhanh. */
  queueTickMs: 1000,
  /** Số lượt "waiting" trước khi được vào (mock). */
  queueSteps: 3,
  /** Nơi lưu phiên + tài khoản qua lần tải lại trang; null trong test. */
  storage: null as Storage | null,
  /** Đồng hồ của mock (tình trạng mở bán phụ thuộc thời điểm). Test thay bằng mốc cố định. */
  now: (): number => Date.now(),
};

const STORAGE_KEY = "ventix.mock.v1";
let counter = 0;

/** UUID dạng v4 hợp lệ, tất định theo bộ đếm để dễ đọc khi debug. */
export function mockId(prefix = "90000000"): string {
  counter += 1;
  return `${prefix}-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

export function randomToken(): string {
  return `mock.${crypto.randomUUID()}`;
}

function hex(value: number, width: number): string {
  return value.toString(16).padStart(width, "0");
}

// ---------- Sự kiện, ghế ----------

export function findEvent(eventId: string): SeedEvent | undefined {
  return seedEvents.find((event) => event.id === eventId);
}

/** Đợt bán đang mở tại `now`, nếu không có thì đợt gần nhất sắp mở (mock luôn cho bán để làm UI). */
export function currentPhase(event: SeedEvent, now = Date.now()): SeedSalePhase {
  const phases = [...event.sale_phases].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const active = phases.find(
    (phase) => Date.parse(phase.starts_at) <= now && now < Date.parse(phase.ends_at),
  );
  const upcoming = phases.find((phase) => Date.parse(phase.starts_at) > now);
  return active ?? upcoming ?? (phases[phases.length - 1] as SeedSalePhase);
}

const seatCache = new Map<string, MockSeat[]>();

/**
 * Ghế giả cho hạng SEATED: event-service chưa có seat map (S-202), nên sinh ID tất định
 * `34000000-0000-4000-8<số sự kiện>-<số ghế>` theo thứ tự hạng vé và `capacity`.
 */
export function seatsOf(eventId: string): MockSeat[] {
  const cached = seatCache.get(eventId);
  if (cached) return cached;
  const index = seedEvents.findIndex((event) => event.id === eventId);
  const event = seedEvents[index];
  if (!event) return [];
  const seats: MockSeat[] = [];
  for (const ticketClass of event.ticket_classes) {
    if (ticketClass.kind !== "SEATED") continue;
    for (let i = 0; i < ticketClass.capacity; i += 1) {
      seats.push({
        id: `34000000-0000-4000-8${hex(index + 1, 3)}-${hex(seats.length + 1, 12)}`,
        ticket_class_id: ticketClass.id,
      });
    }
  }
  seatCache.set(eventId, seats);
  return seats;
}

export function seatById(eventId: string, seatId: string): MockSeat | undefined {
  const seats = seatsOf(eventId);
  const match = /-([0-9a-f]{12})$/.exec(seatId);
  const seat = match ? seats[parseInt(match[1] as string, 16) - 1] : undefined;
  return seat?.id === seatId ? seat : undefined;
}

export function priceOf(eventId: string, ticketClassId: string): number {
  return findEvent(eventId)?.ticket_classes.find((tc) => tc.id === ticketClassId)?.price_vnd ?? 0;
}

export function skuById(skuId: string) {
  return seedMerch.skus.find((sku) => sku.id === skuId);
}

export function skuBelongsToEvent(skuId: string, eventId: string): boolean {
  const sku = skuById(skuId);
  const product = sku && seedMerch.products.find((p) => p.id === sku.product_id);
  return product?.event_id === eventId;
}

/** Ghế đang giữ còn hiệu lực của một sự kiện (dọn ghế hết hạn khi đọc). */
export function activeHolds(eventId: string, now = Date.now()) {
  let holds = state.holds.get(eventId);
  if (!holds) {
    holds = new Map();
    state.holds.set(eventId, holds);
  }
  for (const [seatId, hold] of holds) {
    if (hold.expiresAt <= now) holds.delete(seatId);
  }
  return holds;
}

export function soldSeats(eventId: string): Set<string> {
  let sold = state.sold.get(eventId);
  if (!sold) {
    // Một phần ghế đã bán sẵn để seat map có màu "đã bán" khi demo.
    sold = new Set(
      seatsOf(eventId)
        .filter((_seat, i) => i % 9 === 4)
        .map((seat) => seat.id),
    );
    state.sold.set(eventId, sold);
  }
  return sold;
}

const seatListeners = new Map<string, Set<SeatListener>>();

export function onSeatChange(eventId: string, listener: SeatListener): () => void {
  const listeners = seatListeners.get(eventId) ?? new Set();
  listeners.add(listener);
  seatListeners.set(eventId, listeners);
  return () => listeners.delete(listener);
}

export function emitSeatChange(eventId: string, deltas: SeatDelta[]): void {
  if (deltas.length === 0) return;
  for (const listener of seatListeners.get(eventId) ?? []) listener(deltas);
}

// ---------- Tài khoản, token ----------

export function issueAccessToken(userId: string, organizerId: string | null = null): string {
  const token = randomToken();
  state.tokens.set(token, {
    userId,
    organizerId,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_SEC * 1000,
  });
  return token;
}

export function userById(userId: string): MockUser | undefined {
  for (const user of state.users.values()) if (user.id === userId) return user;
  return undefined;
}

/** Role hiệu lực của token: role toàn cục + role trong tenant khi token đã chọn organizer. */
export function rolesOf(grant: AccessGrant): string[] {
  const user = userById(grant.userId);
  if (!user) return [];
  const tenantRoles = user.memberships
    .filter((m) => m.organizer_id === grant.organizerId)
    .map((m) => m.role);
  return [...new Set([...user.roles, ...tenantRoles])];
}

export function setRefreshSession(userId: string | null): void {
  state.refreshUserId = userId;
  persist();
}

// ---------- Finance ----------

/** Chia gross gồm VAT thành net + vat theo công thức half-up của ADR-0012. */
export function splitVat(gross: number): { net: string; vat: string } {
  const g = BigInt(gross);
  const net = (g * 10000n + (10000n + VAT_RATE_BPS) / 2n) / (10000n + VAT_RATE_BPS);
  return { net: net.toString(), vat: (g - net).toString() };
}

// ---------- Khởi tạo, lưu tạm ----------

function demoUser(
  key: keyof typeof DEMO_USERS,
  roles: string[],
  memberships: Membership[] = [],
): MockUser {
  const { id, email } = DEMO_USERS[key];
  return { id, email, password: key === "google" ? null : DEMO_PASSWORD, roles, memberships };
}

function initialState(): MockState {
  const users = [
    demoUser("user", ["USER"]),
    demoUser(
      "organizer",
      ["USER"],
      [{ organizer_id: DEMO_ORGANIZER_ID, role: "ORGANIZER" as const }],
    ),
    demoUser("staff", ["USER"], [{ organizer_id: DEMO_ORGANIZER_ID, role: "STAFF" as const }]),
    demoUser("admin", ["USER", "ADMIN"]),
    demoUser("google", ["USER"]),
  ];
  const pendingId = "10000000-0000-4000-8000-0000000000f1";
  const now = new Date().toISOString();
  return {
    users: new Map(users.map((user) => [user.email, user])),
    tokens: new Map(),
    refreshUserId: null,
    idempotency: new Map(),
    applications: new Map([
      [
        pendingId,
        {
          id: pendingId,
          owner_user_id: DEMO_USERS.user.id,
          company_name: "Công ty TNHH Sự Kiện Mẫu",
          tax_code: "0312345678",
          status: "PENDING",
          version: 1,
          created_at: now,
          approved_at: null,
        },
      ],
    ]),
    documents: new Map([
      [pendingId, [{ id: mockId("11000000"), doc_type: "BUSINESS_LICENSE", created_at: now }]],
    ]),
    holds: new Map(),
    sold: new Map(),
    orders: new Map(),
    payments: new Map(),
    queues: new Map(),
    admissions: new Map(),
    organizer: initialOrganizerState(DEMO_ORGANIZER_ID),
    dlq: [
      {
        id: "12000000-0000-4000-8000-000000000001",
        topic: "booking.order.dlq",
        partition: 0,
        offset: "42",
        original_topic: "booking.order",
        message_id: "12100000-0000-4000-8000-000000000001",
        message_key: null,
        payload: btoa('{"note":"mock"}'),
        headers: {},
        error: "SCHEMA_INVALID: missing field total_amount_vnd",
        status: "PENDING",
        created_at: now,
        updated_at: now,
        version: 1,
      },
    ],
    audit: [
      {
        id: "1",
        message_id: "12200000-0000-4000-8000-000000000001",
        actor_id: DEMO_USERS.admin.id,
        action: "ORGANIZER_APPROVED",
        resource_type: "organizer",
        resource_id: DEMO_ORGANIZER_ID,
        before_state: { status: "PENDING" },
        after_state: { status: "APPROVED" },
        prev_hash: "0".repeat(64),
        hash: "a".repeat(64),
        created_at: now,
      },
    ],
  };
}

interface Persisted {
  refreshUserId: string | null;
  users: MockUser[];
}

function persist(): void {
  try {
    const data: Persisted = {
      refreshUserId: state.refreshUserId,
      users: [...state.users.values()],
    };
    mockConfig.storage?.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Trình duyệt chặn storage: chỉ mất phiên khi tải lại, mock vẫn chạy.
  }
}

function restore(): void {
  try {
    const raw = mockConfig.storage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as Persisted;
    for (const user of data.users) state.users.set(user.email, user);
    state.refreshUserId = data.refreshUserId;
  } catch {
    // Dữ liệu cũ hỏng: bỏ qua, dùng trạng thái mặc định.
  }
}

export let state: MockState = initialState();

/** Gọi khi khởi động worker để khôi phục phiên đăng nhập sau khi tải lại trang. */
export function restoreMockState(storage: Storage | null): void {
  mockConfig.storage = storage;
  restore();
}

/** Trả về trạng thái ban đầu (dùng giữa các test). */
export function resetMockState(): void {
  counter = 0;
  state = initialState();
  seatListeners.clear();
  try {
    mockConfig.storage?.removeItem(STORAGE_KEY);
  } catch {
    // Không quan trọng với mock.
  }
}

export function savePersistedUsers(): void {
  persist();
}
