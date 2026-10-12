import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Topics, newMessage, parseMessage, topicOf, eventSchemas, TopicPartitions } from "../src";

const uuid = () => randomUUID();

describe("event contracts v1 (draft)", () => {
  it("parse được OrderCreated hợp lệ", () => {
    const msg = newMessage("OrderCreated", {
      order_id: uuid(),
      user_id: uuid(),
      event_id: uuid(),
      items: [{ item_type: "TICKET_SEAT", ref_id: uuid(), quantity: 1, unit_price_vnd: 500000 }],
      ticket_amount_vnd: 500000,
      merch_amount_vnd: 0,
      total_amount_vnd: 500000,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    expect(parseMessage(msg).type).toBe("OrderCreated");
  });

  it("từ chối số tiền không phải số nguyên", () => {
    const msg = newMessage("PaymentSucceeded", {
      payment_id: uuid(),
      purpose: "ORDER",
      order_id: uuid(),
      amount_vnd: 100.5,
      provider: "MOCK",
      provider_txn_id: "x",
      paid_at: new Date().toISOString(),
    });
    expect(() => parseMessage(msg)).toThrow();
  });

  it("từ chối type lạ", () => {
    expect(() => parseMessage({ type: "Nope" })).toThrow(/Unknown event type/);
  });

  it("mọi event đều có topic và topic đều có số partition", () => {
    for (const t of Object.keys(eventSchemas)) {
      const topic = topicOf[t as keyof typeof topicOf];
      expect(Object.values(Topics)).toContain(topic);
      expect(TopicPartitions[topic as keyof typeof TopicPartitions]).toBeGreaterThan(0);
    }
  });

  describe("saga contracts (ADR-0009)", () => {
    const base = () => ({
      order_id: uuid(),
      user_id: uuid(),
      event_id: uuid(),
      payment_id: uuid(),
      confirmed_at: new Date().toISOString(),
    });
    const seatItem = (price = 500000) => ({
      order_item_id: uuid(),
      item_type: "TICKET_SEAT" as const,
      ref_id: uuid(),
      quantity: 1,
      unit_price_vnd: price,
    });
    const merchItem = (qty = 2, price = 100000) => ({
      order_item_id: uuid(),
      item_type: "MERCH" as const,
      ref_id: uuid(),
      quantity: qty,
      unit_price_vnd: price,
    });

    it("OrderAwaitingPayment hợp lệ, đúng topic booking.orders", () => {
      const msg = newMessage("OrderAwaitingPayment", {
        order_id: uuid(),
        user_id: uuid(),
        event_id: uuid(),
        amount_vnd: 700000,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      });
      expect(parseMessage(msg).type).toBe("OrderAwaitingPayment");
      expect(topicOf.OrderAwaitingPayment).toBe(Topics.BOOKING_ORDERS);
    });

    it("OrderConfirmed hợp lệ khi tổng tiền khớp các dòng", () => {
      const msg = newMessage("OrderConfirmed", {
        ...base(),
        items: [seatItem(), seatItem(), merchItem()],
        ticket_amount_vnd: 1000000,
        merch_amount_vnd: 200000,
        total_amount_vnd: 1200000,
      });
      expect(parseMessage(msg).type).toBe("OrderConfirmed");
    });

    it("OrderConfirmed bị từ chối khi ticket_amount sai", () => {
      const msg = newMessage("OrderConfirmed", {
        ...base(),
        items: [seatItem()],
        ticket_amount_vnd: 499999,
        merch_amount_vnd: 0,
        total_amount_vnd: 499999,
      });
      expect(() => parseMessage(msg)).toThrow(/ticket_amount_vnd/);
    });

    it("OrderConfirmed bị từ chối khi merch_amount sai", () => {
      const msg = newMessage("OrderConfirmed", {
        ...base(),
        items: [seatItem(), merchItem()],
        ticket_amount_vnd: 500000,
        merch_amount_vnd: 1,
        total_amount_vnd: 500001,
      });
      expect(() => parseMessage(msg)).toThrow(/merch_amount_vnd/);
    });

    it("OrderConfirmed bị từ chối khi total != ticket + merch", () => {
      const msg = newMessage("OrderConfirmed", {
        ...base(),
        items: [seatItem()],
        ticket_amount_vnd: 500000,
        merch_amount_vnd: 0,
        total_amount_vnd: 600000,
      });
      expect(() => parseMessage(msg)).toThrow(/total_amount_vnd/);
    });

    it("OrderConfirmed: TICKET_SEAT phải có quantity = 1", () => {
      const item = { ...seatItem(), quantity: 2 };
      const msg = newMessage("OrderConfirmed", {
        ...base(),
        items: [item],
        ticket_amount_vnd: 1000000,
        merch_amount_vnd: 0,
        total_amount_vnd: 1000000,
      });
      expect(() => parseMessage(msg)).toThrow(/quantity/);
    });

    it("OrderConfirmed không chấp nhận item COMBO và không chấp nhận danh sách rỗng", () => {
      const combo = { ...merchItem(), item_type: "COMBO" };
      const withCombo = newMessage("OrderConfirmed", {
        ...base(),
        items: [combo],
        ticket_amount_vnd: 0,
        merch_amount_vnd: 200000,
        total_amount_vnd: 200000,
      });
      expect(() => parseMessage(withCombo)).toThrow();
      const empty = newMessage("OrderConfirmed", {
        ...base(),
        items: [],
        ticket_amount_vnd: 0,
        merch_amount_vnd: 0,
        total_amount_vnd: 0,
      });
      expect(() => parseMessage(empty)).toThrow();
    });

    it("OrderCancelled chấp nhận reason LATE_PAYMENT, từ chối reason lạ", () => {
      const ok = newMessage("OrderCancelled", {
        order_id: uuid(),
        event_id: uuid(),
        reason: "LATE_PAYMENT",
      });
      expect(parseMessage(ok).type).toBe("OrderCancelled");
      const bad = newMessage("OrderCancelled", {
        order_id: uuid(),
        event_id: uuid(),
        reason: "WHATEVER",
      });
      expect(() => parseMessage(bad)).toThrow();
    });

    it("OrderCreated cho phép combo_id tùy chọn", () => {
      const msg = newMessage("OrderCreated", {
        order_id: uuid(),
        user_id: uuid(),
        event_id: uuid(),
        items: [
          {
            item_type: "MERCH",
            ref_id: uuid(),
            quantity: 1,
            unit_price_vnd: 100000,
            combo_id: uuid(),
          },
        ],
        ticket_amount_vnd: 0,
        merch_amount_vnd: 100000,
        total_amount_vnd: 100000,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      });
      expect(parseMessage(msg).type).toBe("OrderCreated");
    });
  });
});
