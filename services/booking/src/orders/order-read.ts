import { Controller, Get, Injectable, Param, ParseUUIDPipe, Header } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { CurrentUser, AuthUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { CheckoutRepository } from "../checkout/checkout.repository";

export class OrderView {
  @ApiProperty({ format: "uuid" }) order_id!: string;
  @ApiProperty() event_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() total_amount_vnd!: number;
  @ApiProperty() ticket_amount_vnd!: number;
  @ApiProperty() merch_amount_vnd!: number;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ type: [Object] }) items!: object[];
}
@Injectable()
export class OrderReadService {
  constructor(private readonly repo: CheckoutRepository) {}
  async get(id: string, user: string): Promise<OrderView> {
    const result = await this.repo.pool.query<{
      id: string;
      event_id: string;
      status: string;
      total_amount_vnd: string;
      ticket_amount_vnd: string;
      merch_amount_vnd: string;
      expires_at: Date;
    }>(
      "SELECT id,event_id,status,total_amount_vnd,ticket_amount_vnd,merch_amount_vnd,expires_at FROM orders WHERE id=$1 AND user_id=$2",
      [id, user],
    );
    const order = result.rows[0];
    if (!order) throw new ProblemException("ORDER_NOT_FOUND", 404, "Order not found");
    const items = await this.repo.pool.query<{
      id: string;
      item_type: string;
      ref_id: string;
      quantity: number;
      unit_price_vnd: string;
    }>(
      "SELECT id,item_type,ref_id,quantity,unit_price_vnd FROM order_items WHERE order_id=$1 ORDER BY id",
      [id],
    );
    return {
      order_id: order.id,
      event_id: order.event_id,
      status: order.status,
      total_amount_vnd: Number(order.total_amount_vnd),
      ticket_amount_vnd: Number(order.ticket_amount_vnd),
      merch_amount_vnd: Number(order.merch_amount_vnd),
      expires_at: order.expires_at.toISOString(),
      items: items.rows.map((item) => ({ ...item, unit_price_vnd: Number(item.unit_price_vnd) })),
    };
  }
}
@ApiTags("orders")
@ApiBearerAuth()
@Controller("orders")
export class OrderReadController {
  constructor(private readonly orders: OrderReadService) {}
  @Get(":orderId")
  @Header("Cache-Control", "private, no-store")
  @ApiOkResponse({ type: OrderView })
  @ApiOperation({ summary: "Read an order owned by the authenticated user" })
  @ApiResponse({ status: 401, description: "JWT required" })
  @ApiResponse({ status: 404, description: "ORDER_NOT_FOUND; absent or not owned" })
  get(@Param("orderId", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.get(id, user.userId);
  }
}
