import { DeliveryType, OrderStatus, OrderType, ReservationStatus } from "@/domain/types/order.type";
import { PaymentMethod, PaymentStatus } from "@/domain/types/payment-transaction.type";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import {
  BEARER,
  EXAMPLE_ORDER_ID,
  EXAMPLE_PRODUCT_ID,
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
  BrowseOrdersSchema,
  CreateOnlineOrderSchema,
  GetOnlineOrderQuoteSchema,
  GetOrderDetailsSchema,
  RenewGuestOrderTokenSchema,
} from "@/presentation/validation/schemas/order.schemas";

const TAG = "Orders";

// ============================================================================
// Response data shapes
//
// Shapes follow OrderMapper:
//   browse -> toSummaryView                          ("OrderSummary")
//   quote  -> toOrderPricingPlainObject              ("OrderPricing")
//   detail -> toDetailsView, one shape per order type (ONLINE / RESERVATION / DINEIN)
// ============================================================================

const OrderSummarySchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
    type: z.enum(Object.values(OrderType)),
    status: z.enum(Object.values(OrderStatus)),
    itemCount: z.number().int().openapi({ example: 2, description: "Number of order lines." }),
    total: z.number().openapi({ example: 58000 }),
    createdAt: dateTime(),
  })
  .openapi("OrderSummary");

const OrderPricingSchema = z
  .object({
    subtotal: z.number().openapi({ example: 50000 }),
    tax: z.number().openapi({ example: 5500 }),
    serviceCharge: z.number().openapi({ example: 2500 }),
    discount: z.number().openapi({ example: 0 }),
    deliveryFee: z.number().openapi({ example: 0 }),
    total: z.number().openapi({ example: 58000 }),
  })
  .openapi("OrderPricing");

const OrderItemSchema = z
  .object({
    productId: z.uuid().openapi({ example: EXAMPLE_PRODUCT_ID }),
    productName: z.string().openapi({ example: "Nasi Goreng Spesial" }),
    priceSnapshot: z.number().openapi({ example: 25000, description: "Unit price when the order was placed." }),
    quantity: z.number().int().openapi({ example: 2 }),
    note: z.string().nullable().optional().openapi({ example: "No chili" }),
    imageUrl: z.string().nullable().openapi({ example: "https://example.com/images/nasi-goreng-1.jpg", description: "Primary image, or null." }),
  })
  .openapi("OrderItem");

const OrderPaymentSchema = z
  .object({
    method: z.enum(Object.values(PaymentMethod)).nullable().optional(),
    status: z.enum(Object.values(PaymentStatus)).openapi({ example: PaymentStatus.UNPAID }),
    paidAt: dateTime().nullable().optional(),
    transactionId: z.string().nullable().optional(),
  })
  .openapi("OrderPayment");

const OrderMemberCustomerSchema = z.object({ memberId: z.uuid() }).openapi("OrderMemberCustomer");

const OrderGuestCustomerSchema = z
  .object({
    guestName: z.string().openapi({ example: "Budi Santoso" }),
    guestEmail: z.email().openapi({ example: "budi@example.com" }),
  })
  .openapi("OrderGuestCustomer");

const OrderCustomerSchema = z.union([OrderMemberCustomerSchema, OrderGuestCustomerSchema]);

const OnlineFulfillmentSchema = z
  .object({
    deliveryType: z.enum(Object.values(DeliveryType)),
    scheduledAt: dateTime().nullable().optional(),
    deliveryLocation: z
      .object({
        address: z.string().openapi({ example: "Jl. Merdeka No. 1, Jakarta" }),
        latitude: z.number().openapi({ example: -6.2088 }),
        longitude: z.number().openapi({ example: 106.8456 }),
      })
      .nullable()
      .openapi({ description: "Null for pickup orders." }),
  })
  .openapi("OnlineFulfillment");

const ReservationFulfillmentSchema = z
  .object({
    tableId: z.string(),
    reservedAt: dateTime(),
    durationInMinutes: z.number().int().openapi({ example: 90 }),
    partySize: z.number().int().openapi({ example: 4 }),
    reservationStatus: z.enum(Object.values(ReservationStatus)),
    notes: z.string().nullable().optional(),
  })
  .openapi("ReservationFulfillment");

const DineInFulfillmentSchema = z
  .object({
    tableId: z.string(),
    tableNumber: z.union([z.number().int(), z.string()]),
    guestCount: z.number().int().openapi({ example: 2 }),
    cashierSessionId: z.string().nullable().optional(),
  })
  .openapi("DineInFulfillment");

const orderBaseShape = {
  id: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
  status: z.enum(Object.values(OrderStatus)),
  items: z.array(OrderItemSchema),
  payment: OrderPaymentSchema,
  pricing: OrderPricingSchema,
  createdAt: dateTime(),
  updatedAt: dateTime("2026-10-29T10:05:00.000Z"),
};

const OnlineOrderDetailsSchema = z
  .object({
    ...orderBaseShape,
    type: z.literal(OrderType.ONLINE),
    customer: OrderCustomerSchema,
    fulfillment: OnlineFulfillmentSchema,
  })
  .openapi("OnlineOrderDetails");

const ReservationOrderDetailsSchema = z
  .object({
    ...orderBaseShape,
    type: z.literal(OrderType.RESERVATION),
    customer: OrderCustomerSchema,
    fulfillment: ReservationFulfillmentSchema,
  })
  .openapi("ReservationOrderDetails");

const DineInOrderDetailsSchema = z
  .object({
    ...orderBaseShape,
    type: z.literal(OrderType.DINEIN),
    fulfillment: DineInFulfillmentSchema,
  })
  .openapi("DineInOrderDetails");

const OrderDetailsSchema = z.discriminatedUnion("type", [OnlineOrderDetailsSchema, ReservationOrderDetailsSchema, DineInOrderDetailsSchema]);

const OrderIdDataSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_ORDER_ID }),
  })
  .openapi("OrderIdData");

// ============================================================================
// Request bodies
//
// `memberId` is not accepted from the client: the controller always sets it from
// the access token (if one is sent), so it's left out of the docs.
// ============================================================================

const CreateOnlineOrderBodySchema = CreateOnlineOrderSchema.omit({ memberId: true, scheduledAt: true }).extend({
  // The validation schema uses z.date(), which a JSON body can't carry (JSON has no Date type), so the docs show the ISO string clients send.
  scheduledAt: z
    .string()
    .openapi({ format: "date-time", example: "2026-11-01T12:30:00.000Z", description: "When the order should be ready." })
    .optional(),
});

const GetOnlineOrderQuoteBodySchema = GetOnlineOrderQuoteSchema.omit({ memberId: true });

// ============================================================================
// POST /orders/online-orders/quotes
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/orders/online-orders/quotes",
  summary: "Get a price quote for an online order",
  description:
    "Public. Calculates the price breakdown (items, service charge, tax, delivery fee) without creating an order. Add `deliveryCoordinate` to include the delivery fee. Send an access token if you're a member.",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    body: jsonBody(GetOnlineOrderQuoteBodySchema, {
      items: [{ productId: EXAMPLE_PRODUCT_ID, quantity: 2 }],
      deliveryCoordinate: { latitude: -6.2088, longitude: 106.8456 },
    }),
  },
  responses: {
    200: successResponse("Order quote", "Order quote retrieved successfully", OrderPricingSchema),
    400: errorResponse(
      "Validation failed, or an item is not a known product",
      validationError(issue.required("items", "array")),
      E.OrderContainsUnknownProductsError,
    ),
    401: commonErrors.invalidAccessToken,
    422: errorResponse("Delivery address is too far away", E.DeliveryDistanceExceededError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /orders/online-orders
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/orders/online-orders",
  summary: "Create an online order",
  description:
    "Public. Members send their access token, and the order is linked to their account. Guests send no token and must provide `guestName` and `guestEmail`; they receive a management token for the order. Delivery orders need an address and coordinates.",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    body: jsonBody(CreateOnlineOrderBodySchema, {
      guestName: "Budi Santoso",
      guestEmail: "budi@example.com",
      deliveryType: DeliveryType.PICKUP,
      items: [{ productId: EXAMPLE_PRODUCT_ID, quantity: 2, note: "No chili" }],
    }),
  },
  responses: {
    201: successResponse("Order created", "Order created successfully", OrderIdDataSchema),
    400: errorResponse(
      "Validation failed, guest details or delivery details are missing, an item is not a known product, or a category is inactive",
      validationError(issue.oneOf("deliveryType", Object.values(DeliveryType)), issue.required("items", "array")),
      E.InvalidOrderGuestDataError,
      E.DeliveryAddressRequiredError,
      E.DeliveryLatitudeRequiredError,
      E.DeliveryLongitudeRequiredError,
      E.OrderContainsUnknownProductsError,
      E.ProductCategoryInactiveError,
    ),
    401: commonErrors.invalidAccessToken,
    422: errorResponse(
      "Minimum quantity not met, delivery address too far away, or not enough stock",
      E.MinimumOrderQuantityNotMetError,
      E.DeliveryDistanceExceededError,
      E.InsufficientStockError,
    ),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /orders/guest-token
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/orders/guest-token",
  summary: "Renew a guest order token",
  description:
    "Public. For guests who lost their order management token. If the order is a guest order and the email matches, a new token is issued. The response is the same whether or not they match, so it can't be used to find out which orders exist. Limited per email by an hourly cap and a cooldown.",
  tags: [TAG],
  request: {
    body: jsonBody(RenewGuestOrderTokenSchema, { orderId: EXAMPLE_ORDER_ID, email: "budi@example.com" }),
  },
  responses: {
    200: successResponse("Request accepted", "Guest order token renewed successfully"),
    400: validationFailed(issue.uuid("orderId"), issue.email("email")),
    429: tooManyRequests(E.GuestOrderTokenRenewRateLimitError, E.GuestOrderTokenRenewCooldownActiveError),
  },
});

// ============================================================================
// GET /orders/browse
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/orders/browse",
  summary: "List orders",
  description:
    "Requires login. Members see only their own orders; other roles see all orders. Optionally filter by type and status and choose the sort order.",
  tags: [TAG],
  security: BEARER,
  request: { query: BrowseOrdersSchema.shape.query },
  responses: {
    200: successResponse("Orders", "Orders retrieved successfully", z.array(OrderSummarySchema)),
    400: validationFailed(issue.oneOf("status", Object.values(OrderStatus))),
    401: commonErrors.unauthorized,
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /orders/{id}
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/orders/{id}",
  summary: "Get an order",
  description:
    "Members send their access token and can only open their own orders. Guests pass the `guestToken` from their order management link as a query parameter. The shape of `data` depends on the order `type` (ONLINE, RESERVATION or DINEIN).",
  tags: [TAG],
  security: OPTIONAL_BEARER,
  request: {
    params: GetOrderDetailsSchema.pick({ id: true }),
    query: GetOrderDetailsSchema.pick({ guestToken: true }),
  },
  responses: {
    200: successResponse("Order details", "Order details retrieved successfully", OrderDetailsSchema),
    400: validationFailed(issue.uuid("id")),
    401: commonErrors.invalidAccessToken,
    403: orderAccessForbidden,
    404: errorResponse("Order or guest token not found", E.OrderNotFoundError, E.GuestOrderTokenNotFoundError),
    410: errorResponse("Guest token expired", E.GuestOrderManagementTokenExpiredError),
    429: tooManyRequests(),
  },
});
