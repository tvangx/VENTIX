import { InboxProcessor } from "@ticketing/outbox-inbox";
import { randomUUID } from "node:crypto";
import { NftHandler } from "../../src/modules/nft/nft.handler";
import { fixture, confirmedOrder } from "./ticket";
import { EventMessage } from "@ticketing/event-contracts";

export function nftInbox(context: Awaited<ReturnType<typeof fixture>>) {
  const handler = new NftHandler();
  const dead: string[] = [];
  const inbox = new InboxProcessor({
    db: context.repo.db,
    consumerName: "ticket-nft-v1",
    handler: (executor, message) => handler.handle(executor, message),
    maxAttempts: 1,
    deadLetter: async (letter) => {
      dead.push(JSON.stringify(letter));
    },
  });
  return {
    dead,
    deliver: (message: unknown) =>
      inbox.process({
        topic: "ticket.events",
        partition: 0,
        offset: "0",
        key: null,
        value: Buffer.from(JSON.stringify(message)),
      }),
  };
}

export async function issuedTicket(context: Awaited<ReturnType<typeof fixture>>) {
  const order = confirmedOrder();
  order.data.items = [order.data.items[0]];
  order.data.ticket_amount_vnd = 100;
  order.data.merch_amount_vnd = 0;
  order.data.total_amount_vnd = 100;
  expect(await context.deliver(order)).toBe("processed");
  const result = await context.repo.pool.query<{ payload: EventMessage<"TicketIssued"> }>(
    "SELECT payload FROM outbox_events WHERE payload->'data'->>'order_id'=$1",
    [order.data.order_id],
  );
  const message = result.rows[0].payload;
  return { message, replay: { ...message, message_id: randomUUID() } };
}
