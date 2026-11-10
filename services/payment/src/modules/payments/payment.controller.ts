import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsUUID, ValidateIf } from "class-validator";
import { AuthUser, CurrentUser, Public } from "@ticketing/auth-guard";
import { ProblemException, requestContext } from "@ticketing/common";
import { Request, Response } from "express";
import { PaymentService, IPN_CODES, IpnCode } from "./payment.service";
function VnpayQuery(): MethodDecorator {
  const required = [
    "vnp_TmnCode",
    "vnp_Amount",
    "vnp_BankCode",
    "vnp_OrderInfo",
    "vnp_TransactionNo",
    "vnp_ResponseCode",
    "vnp_TransactionStatus",
    "vnp_TxnRef",
    "vnp_SecureHash",
  ];
  const optional = ["vnp_PayDate", "vnp_BankTranNo", "vnp_CardType", "vnp_SecureHashType"];
  return applyDecorators(
    ...required.map((name) => ApiQuery({ name, required: true, type: String })),
    ...optional.map((name) => ApiQuery({ name, required: false, type: String })),
  );
}
class PaymentDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Exactly one of order_id or resale_order_id",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @ValidateIf(
    (input: PaymentDto, value: unknown) =>
      value !== undefined && input.resale_order_id === undefined,
  )
  @IsUUID()
  order_id?: string;
  @ApiPropertyOptional({
    format: "uuid",
    description: "Exactly one of order_id or resale_order_id",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @ValidateIf(
    (input: PaymentDto, value: unknown) => value !== undefined && input.order_id === undefined,
  )
  @IsUUID()
  resale_order_id?: string;
  @ApiProperty({ enum: ["VNPAY", "MOCK"] }) @IsIn(["VNPAY", "MOCK"]) provider!: "VNPAY" | "MOCK";
}
class PaymentResponse {
  @ApiProperty({ format: "uri" }) redirect_url!: string;
}
class IpnResponse {
  @ApiProperty({ enum: Object.keys(IPN_CODES) }) RspCode!: IpnCode;
  @ApiProperty() Message!: string;
}
class ReturnResponse {
  @ApiProperty() signature_valid!: boolean;
  @ApiProperty() provider_succeeded!: boolean;
}
const trace = () =>
  requestContext.get()?.traceId ?? requestContext.get()?.requestId ?? "payment-callback";
@ApiTags("payments")
@Controller("payments")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  @Post()
  @ApiExtraModels(PaymentDto)
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(PaymentDto) },
        { oneOf: [{ required: ["order_id"] }, { required: ["resale_order_id"] }] },
      ],
    },
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create or replay a payment link for an owned payable order" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ type: PaymentResponse })
  @ApiResponse({ status: 400, description: "Invalid body or Idempotency-Key" })
  @ApiResponse({ status: 401, description: "JWT required" })
  @ApiResponse({ status: 403, description: "PAYMENT_FORBIDDEN" })
  @ApiResponse({
    status: 409,
    description: "ORDER_NOT_READY, PAYABLE_EXPIRED, PAYMENT_ALREADY_ACTIVE",
    headers: { "Retry-After": { schema: { type: "integer", example: 1 } } },
  })
  @ApiResponse({
    status: 422,
    description: "INVALID_PAYMENT_REFERENCE, IDEMPOTENCY_KEY_REUSED, INVALID_PAYMENT_AMOUNT",
  })
  @ApiResponse({ status: 503, description: "PROVIDER_UNAVAILABLE" })
  async create(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: PaymentDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentResponse> {
    if ((input.order_id !== undefined) === (input.resale_order_id !== undefined))
      throw new ProblemException(
        "INVALID_PAYMENT_REFERENCE",
        422,
        "Provide exactly one of order_id or resale_order_id",
      );
    try {
      return await this.payments.create(
        user.userId.toLowerCase(),
        key,
        (input.order_id ?? input.resale_order_id)!,
        input.provider,
        req.socket.remoteAddress?.replace(/^::ffff:/, "") ?? "127.0.0.1",
        trace(),
        input.resale_order_id !== undefined ? "RESALE" : "ORDER",
      );
    } catch (error) {
      if (error instanceof ProblemException && error.code === "ORDER_NOT_READY")
        res.setHeader("Retry-After", "1");
      throw error;
    }
  }
  @Public()
  @Get("vnpay/ipn")
  @VnpayQuery()
  @ApiOperation({ summary: "VNPay server callback; signature checked before processing" })
  @ApiResponse({ status: 200, type: IpnResponse })
  async ipn(@Query() query: Record<string, unknown>): Promise<IpnResponse> {
    const notification = this.payments.vnpay.verifyIpn(query);
    let code: IpnCode = "97";
    if (notification) {
      try {
        code = await this.payments.receive("VNPAY", notification, trace());
      } catch {
        code = "99";
      }
    }
    return { RspCode: code, Message: IPN_CODES[code] };
  }
  @Public()
  @Get("vnpay/return")
  @VnpayQuery()
  @ApiOperation({
    summary: "Verify browser return for display only; does not change payment state",
  })
  @ApiResponse({ status: 200, type: ReturnResponse })
  returnUrl(@Query() query: Record<string, unknown>): ReturnResponse {
    const result = this.payments.vnpay.verifyReturn(query);
    return { signature_valid: result !== null, provider_succeeded: result?.succeeded ?? false };
  }
}
