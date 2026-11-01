import { registry } from "@/presentation/openapi/registry";

/**
 * Security schemes, registered once here (the generator imports this file) so no endpoint
 * file depends on another's import order. Use them by name: security: BEARER / OPTIONAL_BEARER (shared.ts)
 */

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Access token returned in the body of register, login and refresh-session.",
});
