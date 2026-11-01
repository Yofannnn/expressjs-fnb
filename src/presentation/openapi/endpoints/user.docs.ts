import { UserRoleType } from "@/domain/types/user.type";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import { BEARER, errorResponse, successResponse, tooManyRequests } from "@/presentation/openapi/shared";

const TAG = "Users";

// ============================================================================
// Response data shape (follows UserMapper.toProfileView)
// ============================================================================

const UserProfileSchema = z
  .object({
    id: z.uuid().openapi({ example: "5e9d3a7c-2b14-4f60-8c1d-9a7e6b3f2d08" }),
    name: z.string().openapi({ example: "Budi Santoso" }),
    address: z.string().nullable().optional().openapi({ example: "Jl. Merdeka No. 1, Jakarta" }),
    email: z.email().openapi({ example: "budi@example.com" }),
    role: z.enum(Object.values(UserRoleType)),
    emailVerifiedAt: z
      .string()
      .openapi({ format: "date-time", example: "2026-10-02T08:30:00.000Z" })
      .nullable()
      .optional()
      .openapi({ description: "Null until the email address is verified." }),
    createdAt: z.string().openapi({ format: "date-time", example: "2026-10-01T08:00:00.000Z" }),
  })
  .openapi("UserProfile");

// ============================================================================
// GET /users/me
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/users/me",
  summary: "Get the signed-in user's profile",
  description: "Requires login. Returns the profile of the user the access token belongs to.",
  tags: [TAG],
  security: BEARER,
  responses: {
    200: successResponse("The user's profile", "User profile retrieved successfully", UserProfileSchema),
    401: errorResponse("Access token is missing or invalid", E.UnauthenticatedError, E.InvalidAccessTokenError),
    404: errorResponse("The user no longer exists", E.UserNotFoundError),
    429: tooManyRequests(),
  },
});
