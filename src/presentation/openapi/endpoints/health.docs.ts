import { z } from "zod";
import { registry } from "@/presentation/openapi/registry";
import { dateTime } from "@/presentation/openapi/shared";

const healthShape = {
  timestamp: dateTime("2026-10-28T00:42:00.000Z"),
  uptime: z.number().openapi({ description: "Process uptime in seconds", example: 12345.67 }),
  environment: z.string().openapi({ description: "`NODE_ENV`, or `development` when it isn't set.", example: "production" }),
  responseTime: z.string().openapi({ description: "Time taken to run the health checks", example: "42ms" }),
};

const HealthyResponseSchema = z.object({ status: z.literal("healthy"), ...healthShape }).openapi("HealthyResponse");

const UnhealthyResponseSchema = z.object({ status: z.literal("unhealthy"), ...healthShape }).openapi("UnhealthyResponse");

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Check API health",
  description:
    "Checks PostgreSQL (3 s limit) and Redis (2 s limit) at the same time. Returns 503 if either one fails or times out. The body does not say which one failed. Not rate limited.",
  tags: ["Health"],
  responses: {
    200: {
      description: "Database and cache are healthy",
      content: { "application/json": { schema: HealthyResponseSchema } },
    },
    503: {
      description:
        "Database or cache is unhealthy or timed out. Unlike other errors, this body is the health report, not the standard `ErrorResponse`.",
      content: { "application/json": { schema: UnhealthyResponseSchema } },
    },
  },
});
