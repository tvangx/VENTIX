import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ProblemException, Logger } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, SqlExecutor } from "@ticketing/outbox-inbox";
import { z } from "zod";
import { ENV, LOGGER } from "../app.tokens";
import { Env } from "../config/env.schema";
import { MERCH_QUOTE, MerchQuotePort } from "../clients/merch-quote.client";
import { SeatHoldRedisClient } from "../seat-hold/seat-hold-redis";
import { transition } from "../orders/order-state";
import { CheckoutDto, CheckoutResponseDto } from "./checkout.dto";
import { CheckoutRepository, CheckoutTransaction } from "./checkout.repository";

const classesSchema = z.array(
  z.object({
    id: z.string().uuid(),
    price_vnd: z.number().int().nonnegative().safe(),
    kind: z.enum(["SEATED", "GA"]),
  }),
);
const phase = z.object({ starts_at: z.string().datetime(), ends_at: z.string().datetime() });
const windows = z.union([phase, z.array(phase)]);
export interface PricedItem {
  item_type: "TICKET_SEAT" | "TICKET_GA" | "MERCH";
  ref_id: string;
  quantity: number;
  unit_price_vnd: number;
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: CheckoutRepository,
    private readonly cache: SeatHoldRedisClient,
    @Inject(MERCH_QUOTE) private readonly merch: MerchQuotePort,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async checkout(
    userId: string,
    key: string,
    input: CheckoutDto,
    traceId: string,
  ): Promise<CheckoutResponseDto> {
    if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "A valid Idempotency-Key header is required",
      );
    if (input.voucher_code)
      throw new ProblemException("VOUCHER_NOT_SUPPORTED", 422, "Vouchers are not supported");
    if (!input.seat_ids.length && !input.ga_items.length && !input.merch_items.length)
      throw new ProblemException("EMPTY_CHECKOUT", 400, "At least one item is required");
    if (this.env.ADMISSION_REQUIRED)
      throw new ProblemException(
        "ADMISSION_REQUIRED",
        403,
        "Admission is required before checkout",
      );
    // Chuẩn hóa thứ tự trước khi hash: cùng lựa chọn không phụ thuộc thứ tự JSON/array.
    const normalized = {
      event_id: input.event_id,
      seat_ids: [...input.seat_ids].sort(),
      ga_items: [...input.ga_items]
        .sort((a, b) => a.ticket_class_id.localeCompare(b.ticket_class_id))
        .map((i) => ({ ticket_class_id: i.ticket_class_id, quantity: i.quantity })),
      merch_items: [...input.merch_items]
        .sort((a, b) => a.sku_id.localeCompare(b.sku_id))
        .map((i) => ({ sku_id: i.sku_id, quantity: i.quantity })),
      voucher_code: input.voucher_code ?? null,
    };
    const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    return this.repository.db.transaction(async (exec) => {
      const tx = new CheckoutTransaction(exec);
      await tx.lock(`checkout:key:${key}`);
      const old = await tx.previous(key);
      if (old) {
        if (old.user_id !== userId || old.request_hash !== hash)
          throw new ProblemException(
            "IDEMPOTENCY_KEY_REUSED",
            422,
            "Idempotency key was already used for a different request",
          );
        return old.response;
      }
      // Khóa user/event ngăn cleanup của checkout thua nhả hold của checkout đang chạy cùng user.
      await tx.lock(`checkout:user:${input.event_id}:${userId}`);
      const snapshot = await tx.snapshot(input.event_id);
      const window = windows.safeParse(snapshot?.sale_window);
      const phases = window.success
        ? Array.isArray(window.data)
          ? window.data
          : [window.data]
        : [];
      const now = Date.now();
      if (
        !snapshot ||
        !["APPROVED", "PUBLISHED"].includes(snapshot.status) ||
        !phases.some((p) => Date.parse(p.starts_at) <= now && now < Date.parse(p.ends_at))
      )
        throw new ProblemException("EVENT_NOT_ON_SALE", 409, "Event is not currently on sale");
      if (!snapshot.pricing_ready)
        throw new ProblemException("EVENT_NOT_READY", 503, "Event pricing is not ready");
      const classes = classesSchema.parse(snapshot.ticket_classes);
      const prices = await tx.prices(input.event_id, snapshot.seat_map_version, input.seat_ids);
      if (prices.length !== input.seat_ids.length)
        throw new ProblemException("SEAT_UNAVAILABLE", 409, "Seat pricing is unavailable");
      const items: PricedItem[] = [];
      const stock = new Map<string, number>();
      const ticketClassIds = new Set<string>();
      const ticket = (id: string, quantity: number, kind: "GA" | "SEATED", refId: string) => {
        const found = classes.find((c) => c.id === id && c.kind === kind);
        if (!found)
          throw new ProblemException(
            "INVALID_TICKET_CLASS",
            422,
            "Ticket class does not belong to this event or item type",
          );
        ticketClassIds.add(id);
        if (kind === "GA") stock.set(id, (stock.get(id) ?? 0) + quantity);
        items.push({
          item_type: kind === "GA" ? "TICKET_GA" : "TICKET_SEAT",
          ref_id: refId,
          quantity,
          unit_price_vnd: found.price_vnd,
        });
      };
      for (const seat of prices) ticket(seat.ticket_class_id, 1, "SEATED", seat.seat_id);
      for (const ga of normalized.ga_items)
        ticket(ga.ticket_class_id, ga.quantity, "GA", ga.ticket_class_id);
      const ticketAmount = items.reduce((sum, i) => sum + i.quantity * i.unit_price_vnd, 0);
      let merchAmount = 0;
      if (input.merch_items.length) {
        const quote = await this.merch.quote({
          event_id: input.event_id,
          ticket_class_ids: [...ticketClassIds].sort(),
          merch_items: normalized.merch_items,
        });
        merchAmount = quote.merch_amount_vnd;
        items.push(
          ...quote.lines.map((i) => ({
            item_type: "MERCH" as const,
            ref_id: i.sku_id,
            quantity: i.quantity,
            unit_price_vnd: i.unit_price_vnd,
          })),
        );
      }
      if (!Number.isSafeInteger(ticketAmount + merchAmount))
        throw new ProblemException(
          "AMOUNT_OUT_OF_RANGE",
          422,
          "Order amount exceeds supported range",
        );
      let expires = Date.now() + this.env.ORDER_PAYMENT_WINDOW_SECONDS * 1000;
      if (input.seat_ids.length) {
        expires = await this.redis(async () =>
          (await this.cache.connected()).checkoutHold(
            input.seat_ids.length + 1,
            `hold:{evt:${input.event_id}}:${userId}`,
            ...input.seat_ids.map((id) => `seat:{evt:${input.event_id}}:${id}`),
            `H:${userId}`,
            expires,
            ...input.seat_ids,
          ),
        );
        if (!expires)
          throw new ProblemException(
            "HOLD_NOT_FOUND",
            409,
            "An active hold owned by this user is required",
          );
      }
      const id = randomUUID();
      const result: CheckoutResponseDto = {
        order_id: id,
        status: input.merch_items.length ? "PENDING" : "AWAITING_PAYMENT",
        ticket_amount_vnd: ticketAmount,
        merch_amount_vnd: merchAmount,
        total_amount_vnd: ticketAmount + merchAmount,
        expires_at: new Date(expires).toISOString(),
      };
      try {
        await this.createOrder(
          exec,
          userId,
          key,
          input.event_id,
          result,
          items,
          stock,
          traceId,
          snapshot.organizer_id,
        );
      } catch (error) {
        if ((error as { constraint?: string }).constraint === "uq_seat_active") {
          // Nhả trước ROLLBACK để advisory lock user/event còn được giữ.
          await this.release(userId, input.event_id, input.seat_ids);
          throw new ProblemException(
            "SEAT_UNAVAILABLE",
            409,
            "A requested seat was already allocated",
          );
        }
        throw error;
      }
      await tx.remember(key, userId, hash, result);
      this.logger.info(
        { request_id: traceId, trace_id: traceId, order_id: id, user_id: userId },
        "booking: checkout prepared",
      );
      return result;
    });
  }

  private async createOrder(
    exec: SqlExecutor,
    userId: string,
    key: string,
    eventId: string,
    result: CheckoutResponseDto,
    items: PricedItem[],
    stock: Map<string, number>,
    traceId: string,
    tenant: string,
  ): Promise<void> {
    const id = result.order_id;
    const tx = new CheckoutTransaction(exec);
    await tx.insertOrder(userId, key, eventId, result, items);
    for (const [classId, quantity] of [...stock].sort(([a], [b]) => a.localeCompare(b))) {
      if (!(await tx.reserveGa(classId, quantity)))
        throw new ProblemException("TICKET_UNAVAILABLE", 409, "Ticket class stock is exhausted");
    }
    const outbox = new OutboxService();
    await outbox.add(
      exec,
      newMessage(
        "OrderCreated",
        { ...result, user_id: userId, event_id: eventId, items },
        { trace_id: traceId, tenant_id: tenant },
      ),
      id,
    );
    if (result.status === "AWAITING_PAYMENT") {
      await transition(exec, id, "PENDING", "AWAITING_PAYMENT", 0);
      await outbox.add(
        exec,
        newMessage(
          "OrderAwaitingPayment",
          {
            order_id: id,
            user_id: userId,
            event_id: eventId,
            amount_vnd: result.total_amount_vnd,
            expires_at: result.expires_at,
          },
          { trace_id: traceId, tenant_id: tenant },
        ),
        id,
      );
    }
  }
  private async redis<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new ProblemException(
        "SEAT_HOLD_UNAVAILABLE",
        503,
        "Seat holds are temporarily unavailable",
      );
    }
  }
  async release(userId: string, eventId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.redis(async () =>
      (await this.cache.connected()).releaseSeats(
        ids.length + 1,
        `hold:{evt:${eventId}}:${userId}`,
        ...ids.map((id) => `seat:{evt:${eventId}}:${id}`),
        `H:${userId}`,
        ...ids,
      ),
    );
  }
}
