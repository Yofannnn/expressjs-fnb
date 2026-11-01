import { z } from "zod";
import { registry } from "@/presentation/openapi/registry";

/**
 * Error docs.
 *
 * Every error response in the API has the same body (`HttpException.toResponse()`), so there is ONE
 * schema (`ErrorResponse`) and each possible error is a named *example* of it. `defineError()` makes
 * one such example; `errorResponse()` in shared.ts puts the ones for a status code into a response.
 *
 * Not in the body: the exception name (logs only). `code` is just `HTTP_<status>`, the status line again.
 *
 * Status codes come from `src/presentation/exceptions/registries/*`;
 */

export const ValidationErrorDetailsSchema = registry.register(
  "ValidationErrorDetails",
  z
    .object({
      issues: z.array(
        z.object({
          field: z.string().openapi({ example: "email" }),
          message: z.string().openapi({ example: "Invalid email address" }),
          code: z.string().openapi({ example: "invalid_format" }),
          expected: z.unknown().optional(),
          received: z.unknown().optional(),
        }),
      ),
      totalIssues: z.number().int().openapi({ example: 2 }),
    })
    .openapi({ description: "`details` of a validation error (400)." }),
);

/** The body of every error response. */
export const ErrorResponseSchema = registry.register(
  "ErrorResponse",
  z.object({
    requestId: z.string().openapi({ example: "122bff46-547c-455e-b4e4-ab238f536de9" }),
    message: z.string().openapi({ example: "Order not found" }),
    code: z.string().openapi({
      example: "HTTP_404",
      description: "Always `HTTP_<status>`: it repeats the HTTP status line and says nothing more. Use the status to branch.",
    }),
    details: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Extra context for some errors (see each example). For validation errors see `ValidationErrorDetails`.",
    }),
    timestamp: z.string().openapi({ format: "date-time", example: "2026-10-28T08:00:00.000Z" }),
    retryable: z.boolean().openapi({
      example: false,
      description: "Set per exception in the registries. Currently `false` for every mapped exception, 429 and 503 included.",
    }),
  }),
);

/** One entry of `details.issues`; same fields `ZodRequestValidation` emits (`received` is the offending input). */
export interface ValidationIssueDoc {
  field: string;
  message: string;
  code: string;
  expected?: unknown;
  received?: unknown;
}

/**
 * Builders for realistic validation issues (Zod 4 wording), so each route can show the
 * failures its own request fields can actually produce.
 */
export const issue = {
  /** A required field is missing. */
  required: (field: string, expected = "string"): ValidationIssueDoc => ({
    field,
    message: `Invalid input: expected ${expected}, received undefined`,
    code: "invalid_type",
    expected,
  }),
  email: (field = "email", received = "budi@"): ValidationIssueDoc => ({ field, message: "Invalid email address", code: "invalid_format", received }),
  uuid: (field: string, received = "123"): ValidationIssueDoc => ({ field, message: "Invalid UUID", code: "invalid_format", received }),
  /** `detail` is Zod's text, e.g. "expected string to have >=8 characters". */
  tooSmall: (field: string, detail: string, received?: unknown): ValidationIssueDoc => ({
    field,
    message: `Too small: ${detail}`,
    code: "too_small",
    received,
  }),
  /** A value outside an enum; pass the real enum values. */
  oneOf: (field: string, options: readonly string[], received = "UNKNOWN"): ValidationIssueDoc => ({
    field,
    message: `Invalid option: expected one of ${options.map((o) => `"${o}"`).join("|")}`,
    code: "invalid_value",
    received,
  }),
};

/** A 400 validation error for one route. Not added to `errorCatalog` (the generic `RequestValidationError` is). */
export function validationError(...issues: ValidationIssueDoc[]): ErrorDoc {
  return Object.freeze({
    statusCode: 400,
    exceptionName: "RequestValidationException",
    message: `Validation failed with ${issues.length} issue(s)`,
    details: { issues, totalIssues: issues.length },
  });
}

/**
 * A 403 `ForbiddenActionException` for one route: `Forbidden: <actor> cannot <action>.`
 * `actor` is exactly what the code passes, e.g. "User with role CASHIER" or "Anonymous user".
 */
export function forbiddenError(actor: string, action: string, label?: string): ErrorDoc {
  return Object.freeze({
    statusCode: 403,
    exceptionName: "ForbiddenActionException",
    message: `Forbidden: ${actor} cannot ${action}.`,
    details: { actor, action },
    label,
  });
}

/** Real `details` payloads keyed by exception name; keys come from each class's `withDetails(...)`. */
const iso = "2026-10-28T08:00:00.000Z";
const DETAILS_EXAMPLES: Record<string, unknown> = {
  RequestValidationException: {
    issues: [issue.email("email"), issue.tooSmall("password", "expected string to have >=8 characters", "abc")],
    totalIssues: 2,
  },
  VerificationEmailTokenExpiredException: { expiresAt: iso },
  VerificationEmailTokenAlreadyUsedException: { usedAt: iso },
  PasswordResetTokenExpiredException: { expiresAt: iso },
  PasswordResetTokenExpiredBeyondGracePeriodException: { expiresAt: iso },
  PasswordResetTokenAlreadyUsedException: { usedAt: iso },
  GuestOrderManagementTokenExpiredException: { expiresAt: iso },
  AccountLockedException: { lockedUntil: iso, attempts: 5 },
  AuthenticationNotAllowedException: { userStatus: "SUSPENDED" },
  ProfileModificationNotAllowedException: { userStatus: "SUSPENDED" },
  UserActivationNotAllowedException: { userStatus: "ACTIVE" },
  RoleAlreadyAssignedException: { role: "ADMIN" },
  RoleChangeNotAllowedException: { userStatus: "SUSPENDED" },
  ActionReasonRequiredException: { action: "suspend" },
  InvalidStatusTransitionException: { currentStatus: "ACTIVE", attemptedAction: "activate" },
  SelfActionNotAllowedException: { action: "suspend" },
  ProductCategoryInactiveException: { name: "Beverages" },
  ForbiddenActionException: { actor: "Anonymous user", action: "view order" },
  ActionNotAuthorizedException: { role: "MANAGER", action: "change user roles" },
  MinimumOrderQuantityNotMetException: { minimum: 3, actual: 1 },
  InvalidPaymentTransactionTransitionException: { from: "SETTLED", to: "PENDING" },
  InvalidExpirationDateException: { received: "2020-01-01T00:00:00.000Z" },
  InvalidExpirationDurationException: { unit: "minutes", received: -5 },
  VerificationTokenRateLimitExceededException: { retryAfterInSeconds: 60 },
  ResetTokenRateLimitExceededException: { retryAfterInSeconds: 60 },
  GuestOrderTokenRenewCooldownActiveException: { retryAfterSeconds: 60 },
  ChargeNotSuccessfulException: { status: "deny" },
  ExternalServiceUnavailableException: { service: "Midtrans" },
  RequestLimitExceededException: { attempts: 101, maxAttempts: 100, ttl: 30 },
  BurstLimitExceededException: { attempts: 21, maxAttempts: 20, ttl: 10 },
  EmergencyThrottleException: { attempts: 1, maxAttempts: 1, ttl: 60 },
};

export interface ErrorDoc {
  readonly statusCode: number;
  readonly exceptionName: string;
  readonly message: string;
  readonly details?: unknown;
  readonly label?: string;
}

/** Every error documented here. Used by the drift test, not at runtime. */
export const errorCatalog: ErrorDoc[] = [];

/** One documented error: the status it comes with, the exception behind it, a real message, and its `details` if any. */
export function defineError(statusCode: number, exceptionName: string, message: string, details?: unknown): ErrorDoc {
  const doc: ErrorDoc = Object.freeze({ statusCode, exceptionName, message, details: details ?? DETAILS_EXAMPLES[exceptionName] });
  errorCatalog.push(doc);
  return doc;
}

// ============================================================================
// 1. PRESENTATION & VALIDATION EXCEPTIONS
// ============================================================================

export const RequestValidationError = defineError(400, "RequestValidationException", "Validation failed with 2 issue(s)");

// ============================================================================
// 2. AUTHENTICATION (application layer)
// ============================================================================

export const InvalidCredentialsError = defineError(401, "InvalidCredentialsException", "Invalid email or password");

export const UnauthenticatedError = defineError(401, "UnauthenticatedException", "You must be logged in to perform this action");

export const InvalidAccessTokenError = defineError(401, "InvalidAccessTokenException", "Invalid or malformed access token");

export const InvalidRefreshTokenError = defineError(401, "InvalidRefreshTokenException", "Invalid or malformed refresh token");

export const AccountLockedError = defineError(403, "AccountLockedException", "Account is temporarily locked due to multiple failed login attempts");

export const AuthenticationNotAllowedError = defineError(401, "AuthenticationNotAllowedException", "User with status SUSPENDED cannot authenticate.");

// ============================================================================
// 3. USER EXCEPTIONS
// ============================================================================

export const UserNotFoundError = defineError(404, "UserNotFoundException", "User account not found");

export const EmailExistsError = defineError(409, "EmailExistsException", "An account with this email address already exists");

export const EmailAlreadyVerifiedError = defineError(409, "EmailAlreadyVerifiedException", "Email already verified.");

export const EmailUnchangedError = defineError(400, "EmailUnchangedException", "The new email is the same as your current email.");

export const PasswordUnchangedError = defineError(400, "PasswordUnchangedException", "The new password is the same as the current password.");

export const ProfileModificationNotAllowedError = defineError(
  403,
  "ProfileModificationNotAllowedException",
  "User with status SUSPENDED cannot modify profile.",
);

export const UserActivationNotAllowedError = defineError(400, "UserActivationNotAllowedException", "User with status ACTIVE cannot be activated.");

export const RoleAlreadyAssignedError = defineError(409, "RoleAlreadyAssignedException", "User already has the ADMIN role.");

export const RoleChangeNotAllowedError = defineError(403, "RoleChangeNotAllowedException", "User with status SUSPENDED cannot change role.");

export const ActionReasonRequiredError = defineError(400, "ActionReasonRequiredException", "A valid reason is required to suspend the user.");

export const InvalidStatusTransitionError = defineError(422, "InvalidStatusTransitionException", "Cannot suspend ACTIVE user");

export const SelfActionNotAllowedError = defineError(403, "SelfActionNotAllowedException", "Cannot suspend yourself.");

export const ActionNotAuthorizedError = defineError(
  403,
  "ActionNotAuthorizedException",
  "User with role MANAGER is not authorized to change user roles.",
);

// ============================================================================
// 4. ACCESS CONTROL (domain)
// ============================================================================

export const ForbiddenActionError = defineError(403, "ForbiddenActionException", "Forbidden: Anonymous user cannot view order.");

// ============================================================================
// 5. APPLICATION TOKEN EXCEPTIONS
// ============================================================================

export const VerificationTokenNotFoundError = defineError(
  404,
  "VerificationTokenNotFoundException",
  "Email verification token is invalid or has expired",
);

export const VerificationTokenRateLimitError = defineError(
  429,
  "VerificationTokenRateLimitExceededException",
  "Email verification token resend rate limit exceeded, please try again in 60 seconds",
);

export const ResetTokenNotFoundError = defineError(404, "ResetTokenNotFoundException", "Password reset token is invalid or has expired");

export const ResetTokenRateLimitError = defineError(
  429,
  "ResetTokenRateLimitExceededException",
  "Password reset token resend rate limit exceeded, please try again in 60 seconds",
);

export const GuestOrderTokenNotFoundError = defineError(404, "GuestOrderTokenNotFoundException", "Guest token is invalid or has expired");

export const GuestOrderTokenRenewRateLimitError = defineError(
  429,
  "GuestOrderTokenRenewRateLimitExceededException",
  "Guest token renew rate limit exceeded",
);

export const GuestOrderTokenRenewCooldownActiveError = defineError(
  429,
  "GuestOrderTokenRenewCooldownActiveException",
  "Guest token renew cooldown active, retry after 30 seconds",
);

// ============================================================================
// 6. DOMAIN – APPLICATION TOKEN STATE (410 Gone)
// ============================================================================

export const VerificationEmailTokenExpiredError = defineError(410, "VerificationEmailTokenExpiredException", "Verification email token has expired.");

export const VerificationEmailTokenAlreadyUsedError = defineError(
  409,
  "VerificationEmailTokenAlreadyUsedException",
  "Verification email token already used.",
);

export const PasswordResetTokenExpiredError = defineError(410, "PasswordResetTokenExpiredException", "Password reset token has expired.");

export const PasswordResetTokenExpiredBeyondGracePeriodError = defineError(
  410,
  "PasswordResetTokenExpiredBeyondGracePeriodException",
  "Password reset token expired beyond grace period",
);

export const PasswordResetTokenAlreadyUsedError = defineError(409, "PasswordResetTokenAlreadyUsedException", "Password reset token already used.");

export const GuestOrderManagementTokenExpiredError = defineError(
  410,
  "GuestOrderManagementTokenExpiredException",
  "Guest order management token has expired.",
);

// ============================================================================
// 7. SESSION EXCEPTIONS
// ============================================================================

export const SessionNotFoundError = defineError(404, "SessionNotFoundException", "Session not found or has been terminated");

export const SessionAlreadyExpiredError = defineError(410, "SessionAlreadyExpiredException", "Session already expired");

export const SessionAlreadyRevokedError = defineError(410, "SessionAlreadyRevokedException", "Session already revoked");

// ============================================================================
// 8. ORDER EXCEPTIONS
// ============================================================================

export const OrderNotFoundError = defineError(404, "OrderNotFoundException", "Order not found");

export const InvalidOrderStatusTransitionError = defineError(
  422,
  "InvalidOrderStatusTransitionException",
  "Order ord_123 cannot transition order from PENDING to COMPLETED",
);

export const OrderAlreadyPaidError = defineError(409, "OrderAlreadyPaidException", "Order ord_123 is already paid");

export const InvalidOrderTypeOperationError = defineError(
  400,
  "InvalidOrderTypeOperationException",
  "Cannot cancel: order ord_123 is type DELIVERY, expected PICKUP",
);

export const DeliveryDistanceExceededError = defineError(422, "DeliveryDistanceExceededException", "Delivery distance 25 km exceeds maximum 10km");

export const InvalidOrderGuestDataError = defineError(
  400,
  "InvalidOrderGuestDataException",
  "Guest orders require both a guest name and a guest email",
);

export const InvalidFulfillmentAccessError = defineError(
  403,
  "InvalidFulfillmentAccessException",
  "Cannot access fulfillment as DELIVERY: this order is type PICKUP",
);

export const DeliveryAddressRequiredError = defineError(
  400,
  "DeliveryAddressRequiredException",
  "A delivery address must be provided for delivery orders.",
);

export const DeliveryLatitudeRequiredError = defineError(
  400,
  "DeliveryLatitudeRequiredException",
  "A delivery latitude must be provided for delivery orders.",
);

export const DeliveryLongitudeRequiredError = defineError(
  400,
  "DeliveryLongitudeRequiredException",
  "A delivery longitude must be provided for delivery orders.",
);

export const InvalidOrderPaymentStateTransitionError = defineError(
  422,
  "InvalidOrderPaymentStateTransitionException",
  "Cannot change payment status from 'PAID' to 'PENDING'.",
);

export const MinimumOrderQuantityNotMetError = defineError(
  422,
  "MinimumOrderQuantityNotMetException",
  "Minimum order quantity not met (minimum: 10, actual: 5)",
);

export const OrderContainsUnknownProductsError = defineError(400, "OrderContainsUnknownProductsException", "Order contains unknown products");

// ============================================================================
// 9. PAYMENT TRANSACTION EXCEPTIONS
// ============================================================================

export const PaymentNotFoundError = defineError(404, "PaymentNotFoundException", "Payment transaction not found");

export const ChargeNotSuccessfulError = defineError(422, "ChargeNotSuccessfulException", "Payment charge not successful");

export const MissingPaymentMethodError = defineError(400, "MissingPaymentMethodException", "Missing payment method");

export const InvalidPaymentTransactionTransitionError = defineError(
  422,
  "InvalidPaymentTransactionTransitionException",
  "Cannot transition payment transaction from PENDING to REFUNDED",
);

export const ZeroRefundError = defineError(400, "ZeroRefundException", "Refund amount cannot be zero");

export const InvalidRefundSourceError = defineError(
  400,
  "InvalidRefundSourceException",
  "Can only refund a CHARGE transaction, but parent transaction is REFUND",
);

export const RefundOnUnsuccessfulChargeError = defineError(
  422,
  "RefundOnUnsuccessfulChargeException",
  "Can only refund a successful transaction, but parent transaction status is FAILED",
);

export const RefundAmountExceedsPreviousRefundsError = defineError(
  422,
  "RefundAmountExceedsPreviousRefundsException",
  "Refund amount cannot exceed the sum of previous refunds. Refund amount: 60000, Previous refunds amount: 50000, Remaining refundable: 40000",
);

// ============================================================================
// 10. PRODUCT & PRODUCT CATEGORY EXCEPTIONS
// ============================================================================

export const ProductNotFoundError = defineError(404, "ProductNotFoundException", "Product not found");

export const ConflictingProductStockOperationError = defineError(409, "ConflictingProductStockOperationException", "Conflicting stock operation");

export const NoProductStockOperationError = defineError(400, "NoProductStockOperationException", "No stock operation");

export const NoReorderProductImageOperationError = defineError(400, "NoReorderProductImageOperationException", "No reorder image operation");

export const InvalidStockQuantityError = defineError(400, "InvalidStockQuantityException", "Stock quantity must not be negative");

export const InvalidRestockQuantityError = defineError(400, "InvalidRestockQuantityException", "Restock quantity must not be negative. Provided: -5");

export const InvalidDeductQuantityError = defineError(400, "InvalidDeductQuantityException", "Deduct quantity must not be negative. Provided: -5");

export const InsufficientStockError = defineError(422, "InsufficientStockException", "Insufficient stock. Requested: 10, Available: 3");

export const InvalidPreparationTimeError = defineError(400, "InvalidPreparationTimeException", "Preparation time must be positive. Provided: -5");

export const ProductWithoutImageError = defineError(400, "ProductWithoutImageException", "Product must have at least one image");

export const ProductImageNotFoundError = defineError(404, "ProductImageNotFoundException", "Product image not found");

export const InvalidReorderProductImageError = defineError(
  400,
  "InvalidReorderProductImageException",
  "Product image reorder must have same length of images",
);

export const ProductCategoryNotFoundError = defineError(404, "ProductCategoryNotFoundException", "Product category not found");

export const ProductCategoryInactiveError = defineError(400, "ProductCategoryInactiveException", "Product category (Beverages) is inactive");

export const ProductCategoryIncompleteReorderListError = defineError(400, "ProductCategoryIncompleteReorderListException", "Incomplete reorder list");

export const UnknownProductCategoryInReorderError = defineError(
  400,
  "UnknownProductCategoryInReorderException",
  "Unknown product category in reorder list",
);

export const ProductCategoryDuplicateSortOrderError = defineError(409, "ProductCategoryDuplicateSortOrderException", "Duplicate sort order");

// ============================================================================
// 11. VALUE OBJECT EXCEPTIONS (Coordinate, Money, Expiration, Numeric)
// ============================================================================

export const InvalidCoordinateError = defineError(400, "InvalidCoordinateException", "Latitude must be between -90 and 90");

export const InvalidCoordinateFormatError = defineError(400, "InvalidCoordinateFormatException", "Coordinate must be a valid decimal string");

export const InvalidExpirationDateError = defineError(400, "InvalidExpirationDateException", "Expiration date must be a valid Date");

export const InvalidExpirationDurationError = defineError(400, "InvalidExpirationDurationException", "Expiration days must be a positive number");

export const InvalidNumericArgumentError = defineError(
  400,
  "InvalidNumericArgumentException",
  "Invalid numeric argument 'quantity': -1 (must be positive)",
);

export const InvalidMoneyAmountError = defineError(400, "InvalidMoneyAmountException", "Money amount must have at most 2 decimal places");

export const NegativeMoneyAmountError = defineError(400, "NegativeMoneyAmountException", "Money amount cannot be negative. Provided: -1000");

export const InsufficientMoneyAmountError = defineError(
  422,
  "InsufficientMoneyAmountException",
  "Insufficient amount. Requested: 50000, Available: 30000",
);

export const InvalidMoneyDivisionError = defineError(
  400,
  "InvalidMoneyDivisionException",
  "Money cannot be divided by 0. Divisor must be greater than zero.",
);

// ============================================================================
// 12. INFRASTRUCTURE EXCEPTIONS
// ============================================================================

export const ExternalServiceUnavailableError = defineError(503, "ExternalServiceUnavailableException", "Midtrans is currently unavailable");

// ============================================================================
// 13. RATE LIMIT EXCEPTIONS (infrastructure/rate-limit)
// ============================================================================

export const RequestLimitExceededError = defineError(429, "RequestLimitExceededException", "Too many requests. Please try again in 30 seconds");

export const BurstLimitExceededError = defineError(
  429,
  "BurstLimitExceededException",
  "Too many requests in short time. Please slow down and try again in 10 seconds",
);

export const EmergencyThrottleError = defineError(429, "EmergencyThrottleException", "Service temporarily limited. Please try again in 60 seconds");
