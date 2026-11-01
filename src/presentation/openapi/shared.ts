import "@/presentation/openapi/registry";
import { z } from "zod";
export { issue, validationError, forbiddenError } from "@/presentation/openapi/errors.docs";
import {
  ErrorResponseSchema,
  type ErrorDoc,
  validationError,
  forbiddenError,
  type ValidationIssueDoc,
  UnauthenticatedError,
  InvalidAccessTokenError,
  RequestLimitExceededError,
  BurstLimitExceededError,
  EmergencyThrottleError,
} from "@/presentation/openapi/errors.docs";

type HeaderDocs = Record<string, { description: string; schema: { type: "string" } }>;

// ============================================================================
// Errors
// ============================================================================

const EXAMPLE_REQUEST_ID = "122bff46-547c-455e-b4e4-ab238f536de9";
const EXAMPLE_TIMESTAMP = "2026-10-28T08:00:00.000Z";

/**
 * Error entry for `registerPath` responses.
 * Always the `ErrorResponse` schema; each error you pass becomes a named example,
 * so a status code with several possible errors shows them as a dropdown.
 * All errors passed must share one status code.
 */
export function errorResponse(description: string, first: ErrorDoc, ...rest: ErrorDoc[]) {
  const docs = [first, ...rest];
  const stray = docs.filter((d) => d.statusCode !== first.statusCode);
  if (stray.length > 0) {
    throw new Error(
      `errorResponse("${description}") mixes status codes: ${first.exceptionName} is ${first.statusCode}, ` +
        stray.map((d) => `${d.exceptionName} is ${d.statusCode}`).join(", "),
    );
  }

  return {
    description,
    content: {
      "application/json": {
        schema: ErrorResponseSchema,
        examples: Object.fromEntries(
          docs.map((d) => [
            d.label ? `${d.exceptionName}_${d.label}` : d.exceptionName,
            {
              summary: d.label ? `${d.exceptionName} (${d.label})` : d.exceptionName,
              value: {
                requestId: EXAMPLE_REQUEST_ID,
                message: d.message,
                code: `HTTP_${d.statusCode}`,
                ...(d.details !== undefined ? { details: d.details } : {}),
                timestamp: EXAMPLE_TIMESTAMP,
                retryable: false,
              },
            },
          ]),
        ),
      },
    },
  };
}

/**
 * 429 entry. Every rate-limited route can return the three limiter errors;
 * pass route-specific 429 errors first.
 */
export function tooManyRequests(...extra: ErrorDoc[]) {
  const [first, ...rest] = [...extra, RequestLimitExceededError, BurstLimitExceededError, EmergencyThrottleError];
  return errorResponse("Too many requests", first!, ...rest);
}

/**
 * 400 for request validation. Pass the issues this route's own fields can produce, using `issue.*`:
 *   validationFailed(issue.email("email"), issue.required("password"))
 */
export function validationFailed(...issues: ValidationIssueDoc[]) {
  return errorResponse("Validation failed", validationError(...issues));
}

/**
 * 403 for a route only some roles may use (`ForbiddenActionException`).
 * `allowed`: the roles the route accepts, in words; `actorRole`: a role that gets refused, for the example.
 *   roleForbidden("create products", "ADMIN and MANAGER", "CASHIER")
 */
export function roleForbidden(action: string, allowed: string, actorRole: string) {
  return errorResponse(`Only ${allowed} can ${action}`, forbiddenError(`User with role ${actorRole}`, action));
}

/** 403 when the caller doesn't own the order (members, anonymous) or the guest token belongs to another order. */
export const orderAccessForbidden = errorResponse(
  "You don't have access to this order",
  forbiddenError("Anonymous user", "view order", "NotOwner"),
  forbiddenError("You", "view order", "GuestTokenForOtherOrder"),
);

/** Responses shared by many routes. */
export const commonErrors = {
  unauthorized: errorResponse("Access token is missing or invalid", UnauthenticatedError, InvalidAccessTokenError),
  invalidAccessToken: errorResponse("The access token that was sent is invalid", InvalidAccessTokenError),
};

// ============================================================================
// Success, request bodies, security, common fields
// ============================================================================

/** Required access token. */
export const BEARER: Record<string, string[]>[] = [{ bearerAuth: [] }];

/** Optional access token: `{}` means "no authentication" is also accepted (guests use `guestToken`; a valid token identifies the member). */
export const OPTIONAL_BEARER: Record<string, string[]>[] = [{}, { bearerAuth: [] }];

/** Example ids, shared so the same order/product flows through every page of the docs. */
export const EXAMPLE_ORDER_ID = "8a1f4c2e-3b7d-4d96-a5e0-6c9b2d7f1e34";
export const EXAMPLE_PRODUCT_ID = "3f6c2b1a-9d47-4e58-b0a1-7c5e8d2f4a63";
export const EXAMPLE_PAYMENT_ID = "c2b8e6d1-4f3a-4b9e-8d27-1a5c7e9f3b60";
export const EXAMPLE_CATEGORY_ID = "0b8f6c1e-5a3d-4e7b-9c21-8f4d2a6b1e90";

/** ISO date-time string field. */
export const dateTime = (example: string = "2026-10-29T10:00:00.000Z") => z.string().openapi({ format: "date-time", example });

/** Success body used by the API: `{ message }` or `{ message, data }`. */
export function successBody(message: string, data?: z.ZodType) {
  const base = { message: z.string().openapi({ example: message }) };
  return data ? z.object({ ...base, data }) : z.object(base);
}

/** Success entry for `registerPath` responses. */
export function successResponse(description: string, message: string, data?: z.ZodType, headers?: HeaderDocs) {
  return {
    description,
    ...(headers ? { headers } : {}),
    content: { "application/json": { schema: successBody(message, data) } },
  };
}

/** JSON request body with a ready-to-send example for "Try it". */
export function jsonBody(schema: z.ZodType, example: unknown) {
  return {
    required: true,
    content: { "application/json": { schema, example } },
  };
}
