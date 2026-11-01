import { AUTH_CONSTANTS } from "@/presentation/constants/auth.constants";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import {
  BEARER,
  errorResponse,
  issue,
  jsonBody,
  successResponse,
  tooManyRequests,
  validationError,
  validationFailed,
} from "@/presentation/openapi/shared";
import {
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  ValidateResetTokenSchema,
  VerifyEmailSchema,
} from "@/presentation/validation/schemas/auth.schemas";

const TAG = "Auth";

// ============================================================================
// Response data shapes
// ============================================================================

const AccessTokenDataSchema = z
  .object({
    accessToken: z.string().openapi({
      description: "JWT access token. Send it as `Authorization: Bearer <token>`.",
      example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMTIzIn0.signature",
    }),
  })
  .openapi("AccessTokenData");

const ValidateResetTokenDataSchema = z
  .object({
    expiresAt: z.string().openapi({ format: "date-time", example: "2026-10-28T09:00:00.000Z" }),
    remainingTimeMs: z.number().openapi({
      description: "Milliseconds left before the token expires.",
      example: 540000,
    }),
  })
  .openapi("ValidateResetTokenData");

const COOKIE = AUTH_CONSTANTS.REFRESH_TOKEN_COOKIE_NAME;
const SEND_COOKIE_NOTE = `Needs the \`${COOKIE}\` cookie that register, login and refresh-session set. Browsers send it automatically: from a frontend use \`credentials: "include"\` (\`withCredentials: true\` in axios), and don't set a header yourself. In this page it works after you log in from the same browser.`;

const SET_REFRESH_COOKIE = {
  "Set-Cookie": {
    description: "Sets the refresh token cookie (HttpOnly, SameSite=Lax, Secure in production).",
    schema: { type: "string" as const },
  },
};

const CLEAR_REFRESH_COOKIE = {
  "Set-Cookie": {
    description: "Clears the refresh token cookie.",
    schema: { type: "string" as const },
  },
};

// ============================================================================
// POST /auth/register
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/register",
  summary: "Register a new member account",
  description:
    "Creates a MEMBER account, starts a session and sends a verification email. The refresh token is set as an HttpOnly cookie and the access token is returned in the body.",
  tags: [TAG],
  request: {
    body: jsonBody(RegisterSchema, {
      name: "Budi Santoso",
      address: "Jl. Merdeka No. 1, Jakarta",
      email: "budi@example.com",
      password: "P@ssw0rd123",
    }),
  },
  responses: {
    201: successResponse("Registered and signed in", "Registration successful!", AccessTokenDataSchema, SET_REFRESH_COOKIE),
    400: validationFailed(issue.required("name"), issue.email("email"), issue.tooSmall("password", "expected string to have >=8 characters", "abc")),
    409: errorResponse("Email already registered", E.EmailExistsError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/login
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/login",
  summary: "Log in with email and password",
  description:
    "Starts a new session. The refresh token is set as an HttpOnly cookie and the access token is returned in the body. Repeated failed attempts lock the account temporarily.",
  tags: [TAG],
  request: {
    body: jsonBody(LoginSchema, {
      email: "budi@example.com",
      password: "P@ssw0rd123",
    }),
  },
  responses: {
    200: successResponse("Logged in", "Login successful.", AccessTokenDataSchema, SET_REFRESH_COOKIE),
    400: validationFailed(issue.email("email"), issue.required("password")),
    401: errorResponse("Wrong credentials, or this account is not allowed to sign in", E.InvalidCredentialsError, E.AuthenticationNotAllowedError),
    403: errorResponse("Account is temporarily locked", E.AccountLockedError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/refresh-session
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/refresh-session",
  summary: "Get a new access token",
  description: `Rotates the session: the old session is revoked and a new refresh token cookie and access token are issued. No request body. ${SEND_COOKIE_NOTE}`,
  tags: [TAG],
  responses: {
    200: successResponse("Session refreshed", "Session refreshed successfully", AccessTokenDataSchema, SET_REFRESH_COOKIE),
    401: errorResponse(
      "Refresh token cookie is missing or invalid, or this account is not allowed to sign in",
      E.UnauthenticatedError,
      E.InvalidRefreshTokenError,
      E.AuthenticationNotAllowedError,
    ),
    404: errorResponse("Session or user not found", E.SessionNotFoundError, E.UserNotFoundError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/logout
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  summary: "Log out",
  description: `Revokes the session tied to the refresh token cookie and clears the cookie. No request body. ${SEND_COOKIE_NOTE}`,
  tags: [TAG],
  responses: {
    200: successResponse("Logged out", "Logged out successfully", undefined, CLEAR_REFRESH_COOKIE),
    401: errorResponse("Refresh token cookie is missing or invalid", E.UnauthenticatedError, E.InvalidRefreshTokenError),
    404: errorResponse("Session or user not found", E.SessionNotFoundError, E.UserNotFoundError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/verify-email
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/verify-email",
  summary: "Verify an email address",
  description: "Confirms the email using the token from the verification email. No login is required.",
  tags: [TAG],
  request: {
    body: jsonBody(VerifyEmailSchema, { verifyEmailToken: "d41d8cd98f00b204e9800998ecf8427e" }),
  },
  responses: {
    200: successResponse("Email verified", "Email verified"),
    400: validationFailed(issue.required("verifyEmailToken")),
    404: errorResponse("Token or user not found", E.VerificationTokenNotFoundError, E.UserNotFoundError),
    409: errorResponse("Email already verified, or token already used", E.EmailAlreadyVerifiedError, E.VerificationEmailTokenAlreadyUsedError),
    410: errorResponse("Token expired", E.VerificationEmailTokenExpiredError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/resend-verification-email
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/resend-verification-email",
  summary: "Resend the verification email",
  description:
    "Sends a new verification email to the signed-in user and invalidates the previous token. Limited by an hourly cap and a cooldown between sends.",
  tags: [TAG],
  security: BEARER,
  responses: {
    200: successResponse("Verification email sent", "Verification email sent"),
    401: errorResponse("Access token is missing or invalid", E.UnauthenticatedError, E.InvalidAccessTokenError),
    404: errorResponse("User not found", E.UserNotFoundError),
    429: tooManyRequests(E.VerificationTokenRateLimitError),
  },
});

// ============================================================================
// POST /auth/forgot-password
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/forgot-password",
  summary: "Request a password reset email",
  description:
    "Sends a reset link if an account with this email exists. The response is the same whether or not the email is registered. Limited by an hourly cap and a cooldown between sends.",
  tags: [TAG],
  request: {
    body: jsonBody(ForgotPasswordSchema, { email: "budi@example.com" }),
  },
  responses: {
    200: successResponse("Request accepted", "Password reset request sent"),
    400: validationFailed(issue.email("email")),
    429: tooManyRequests(E.ResetTokenRateLimitError),
  },
});

// ============================================================================
// POST /auth/validate-reset-password
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/validate-reset-password",
  summary: "Check that a reset token is still valid",
  description: "Use this before showing the new-password form. It does not change anything.",
  tags: [TAG],
  request: {
    body: jsonBody(ValidateResetTokenSchema, { resetPasswordToken: "5f4dcc3b5aa765d61d8327deb882cf99" }),
  },
  responses: {
    200: successResponse("Token is valid", "Token is valid.", ValidateResetTokenDataSchema),
    400: validationFailed(issue.required("resetPasswordToken")),
    404: errorResponse("Token not found", E.ResetTokenNotFoundError),
    410: errorResponse("Token expired beyond the grace period", E.PasswordResetTokenExpiredBeyondGracePeriodError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /auth/reset-password
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/auth/reset-password",
  summary: "Set a new password using a reset token",
  description: "Changes the password and revokes every active session of the user, so they must log in again.",
  tags: [TAG],
  request: {
    body: jsonBody(ResetPasswordSchema, {
      resetPasswordToken: "5f4dcc3b5aa765d61d8327deb882cf99",
      newPassword: "N3w-P@ssword",
    }),
  },
  responses: {
    200: successResponse("Password changed", "Password reset successfully"),
    400: errorResponse(
      "Validation failed, or the new password equals the current one",
      validationError(issue.required("resetPasswordToken"), issue.tooSmall("newPassword", "expected string to have >=8 characters", "abc")),
      E.PasswordUnchangedError,
    ),
    404: errorResponse("Token or user not found", E.ResetTokenNotFoundError, E.UserNotFoundError),
    409: errorResponse("Token already used", E.PasswordResetTokenAlreadyUsedError),
    410: errorResponse("Token expired", E.PasswordResetTokenExpiredError, E.PasswordResetTokenExpiredBeyondGracePeriodError),
    429: tooManyRequests(),
  },
});
