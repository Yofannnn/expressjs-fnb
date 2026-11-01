import { PaymentMethod, PaymentTransactionStatus, PaymentTransactionType } from "@/domain/types/payment-transaction.type";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import {
  EXAMPLE_ORDER_ID,
  EXAMPLE_PAYMENT_ID,
  OPTIONAL_BEARER,
  commonErrors,
  dateTime,
  errorResponse,
  issue,
  jsonBody,
  orderAccessForbidden,
  successResponse,
  tooManyRequests,
  validationError,
  validationFailed,
} from "@/presentation/openapi/shared";
import {
  GetPaymentDetailsSchema,
  GetPaymentsByOrderIdSchema,
  HandlePaymentSchema,
  InitiateChargeSchema,
} from "@/presentation/validation/schemas/payment.schemas";

const TAG = "Payments";

// ============================================================================
// Reusable error responses for this router
// ============================================================================

const guestTokenExpired = errorResponse("Guest token expired", E.GuestOrderManagementTokenExpiredError);
const gatewayUnavailable = errorResponse("The payment gateway is unavailable", E.ExternalServiceUnavailableError);

// ============================================================================
// Response data shapes (follow PaymentMapper)
//   toPlainObject  -> "PaymentTransaction"  (scope: "staff")
//   toDetailsView  -> "PaymentDetails"      (scope: "customer")
// ============================================================================

const PaymentTransactionSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PAYMENT_ID }),
    orderId: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
    amount: z.number().openapi({ example: 58000 }),
    method: z.enum(Object.values(PaymentMethod)).nullable().optional(),
    status: z.enum(Object.values(PaymentTransactionStatus)).openapi({ example: PaymentTransactionStatus.PENDING }),
    completedAt: dateTime("2026-10-30T10:15:00.000Z").nullable().optional(),
    type: z.enum(Object.values(PaymentTransactionType)).openapi({ example: PaymentTransactionType.CHARGE }),
    parentTransactionId: z.string().nullable().optional().openapi({ description: "Set on refunds: the charge being refunded." }),
    failureReason: z.string().nullable().optional(),
    provider: z.string(),
    providerReferenceId: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional().openapi({ description: "Extra data from the payment provider." }),
    createdAt: dateTime("2026-10-30T10:00:00.000Z"),
    updatedAt: dateTime("2026-10-30T10:15:00.000Z"),
  })
  .openapi("PaymentTransaction");

const PaymentDetailsSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PAYMENT_ID }),
    orderId: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
    status: z.enum(Object.values(PaymentTransactionStatus)).openapi({ example: PaymentTransactionStatus.PENDING }),
    amount: z.number().openapi({ example: 58000 }),
    method: z.enum(Object.values(PaymentMethod)).nullable().optional(),
    completedAt: dateTime("2026-10-30T10:15:00.000Z").nullable().optional(),
    type: z.enum(Object.values(PaymentTransactionType)).openapi({ example: PaymentTransactionType.CHARGE }),
    parentTransactionId: z.string().nullable().optional().openapi({ description: "Set on refunds: the charge being refunded." }),
    createdAt: dateTime("2026-10-30T10:00:00.000Z"),
  })
  .openapi("PaymentDetails");

const InitiateChargeDataSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PAYMENT_ID, description: "Payment transaction id. Keep it: it's needed to confirm the payment." }),
    redirectUrl: z.string().nullable().optional().openapi({ description: "Payment page of the gateway." }),
    snapToken: z.string().nullable().optional().openapi({ description: "Token for opening the gateway's Snap payment popup." }),
  })
  .openapi("InitiateChargeData");

const HandlePaymentDataSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PAYMENT_ID }),
    orderId: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
  })
  .openapi("HandlePaymentData");

/**
 * Reads return `{ message, data, scope }`. `scope` sits next to `data` and tells
 * which shape `data` has: "staff" (ADMIN and MANAGER) gets the full transaction, "customer" a trimmed view.
 */
const scopedBody = <S extends "staff" | "customer">(name: string, scope: S, message: string, data: z.ZodType) =>
  z
    .object({
      message: z.string().openapi({ example: message }),
      data,
      scope: z.literal(scope),
    })
    .openapi(name);

const PaymentDetailsResponseSchema = z.discriminatedUnion("scope", [
  scopedBody("PaymentDetailsStaffResponse", "staff", "Payment details retrieved successfully", PaymentTransactionSchema),
  scopedBody("PaymentDetailsCustomerResponse", "customer", "Payment details retrieved successfully", PaymentDetailsSchema),
]);

const PaymentListResponseSchema = z.discriminatedUnion("scope", [
  scopedBody("PaymentListStaffResponse", "staff", "Payments retrieved successfully", z.array(PaymentTransactionSchema)),
  scopedBody("PaymentListCustomerResponse", "customer", "Payments retrieved successfully", z.array(PaymentDetailsSchema)),
]);

// ============================================================================
// POST /payments
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/payments",
  summary: "Start a payment for an order",
  description:
    "Creates a pending payment and a charge at the payment gateway, then returns what the client needs to show the payment page (`redirectUrl` or `snapToken`). Members send their access token. Guests pass the `guestToken` from their order management link as a query parameter. After the customer has paid, confirm it with POST /payments/pay.",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    query: InitiateChargeSchema.pick({ guestToken: true }),
    body: jsonBody(InitiateChargeSchema.pick({ orderId: true }), { orderId: EXAMPLE_ORDER_ID }),
  },
  responses: {
    201: successResponse("Payment started", "Payment initiated successfully", InitiateChargeDataSchema),
    400: validationFailed(issue.uuid("orderId")),
    401: commonErrors.invalidAccessToken,
    403: orderAccessForbidden,
    404: errorResponse("Order or guest token not found", E.OrderNotFoundError, E.GuestOrderTokenNotFoundError),
    409: errorResponse("The order is already paid", E.OrderAlreadyPaidError),
    410: guestTokenExpired,
    429: tooManyRequests(),
    503: gatewayUnavailable,
  },
});

// ============================================================================
// POST /payments/pay
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/payments/pay",
  summary: "Confirm a payment after the customer has paid",
  description:
    "Temporary endpoint, to be replaced by a payment gateway webhook. Public. The server asks the gateway for the real status of the payment, so a payment that hasn't succeeded there is rejected. On success the payment is marked successful, the order is marked paid and confirmed, and stock is deducted. Calling it again for a payment that already succeeded does nothing.",
  tags: [TAG],
  request: {
    body: jsonBody(HandlePaymentSchema, { paymentId: EXAMPLE_PAYMENT_ID }),
  },
  responses: {
    201: successResponse("Payment confirmed", "Payment handled successfully", HandlePaymentDataSchema),
    400: errorResponse(
      "Validation failed, or the gateway reported no payment method",
      validationError(issue.uuid("paymentId")),
      E.MissingPaymentMethodError,
    ),
    404: errorResponse("Payment or order not found", E.PaymentNotFoundError, E.OrderNotFoundError),
    409: errorResponse("The order is already paid", E.OrderAlreadyPaidError),
    422: errorResponse(
      "The gateway doesn't report the charge as successful, the order can no longer be confirmed, or there is not enough stock",
      E.ChargeNotSuccessfulError,
      E.InvalidOrderStatusTransitionError,
      E.InvalidPaymentTransactionTransitionError,
      E.InsufficientStockError,
    ),
    503: gatewayUnavailable,
  },
});

// ============================================================================
// GET /payments/{orderId}/{paymentId}
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/payments/{orderId}/{paymentId}",
  summary: "Get a payment",
  description:
    "Members send their access token and can only open payments of their own orders. Guests pass the `guestToken` query parameter. `scope` in the response tells which shape `data` has: ADMIN and MANAGER get the full transaction, everyone else a trimmed view.",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    params: GetPaymentDetailsSchema.pick({ orderId: true, paymentId: true }),
    query: GetPaymentDetailsSchema.pick({ guestToken: true }),
  },
  responses: {
    200: { description: "Payment details", content: { "application/json": { schema: PaymentDetailsResponseSchema } } },
    400: validationFailed(issue.uuid("orderId"), issue.uuid("paymentId")),
    401: commonErrors.invalidAccessToken,
    403: orderAccessForbidden,
    404: errorResponse("Order, payment or guest token not found", E.OrderNotFoundError, E.PaymentNotFoundError, E.GuestOrderTokenNotFoundError),
    410: guestTokenExpired,
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /payments/{orderId}
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/payments/{orderId}",
  summary: "List the payments of an order",
  description:
    "Members send their access token and can only list payments of their own orders. Guests pass the `guestToken` query parameter. `scope` in the response tells which shape the items in `data` have.",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    params: GetPaymentsByOrderIdSchema.pick({ orderId: true }),
    query: GetPaymentsByOrderIdSchema.pick({ guestToken: true }),
  },
  responses: {
    200: { description: "Payments of the order", content: { "application/json": { schema: PaymentListResponseSchema } } },
    400: validationFailed(issue.uuid("orderId")),
    401: commonErrors.invalidAccessToken,
    403: orderAccessForbidden,
    404: errorResponse("Order or guest token not found", E.OrderNotFoundError, E.GuestOrderTokenNotFoundError),
    410: guestTokenExpired,
    429: tooManyRequests(),
  },
});
