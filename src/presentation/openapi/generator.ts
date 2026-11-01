import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { registry } from "@/presentation/openapi/registry";
import "@/presentation/openapi/security.docs";
import "@/presentation/openapi/endpoints/health.docs";
import "@/presentation/openapi/endpoints/auth.docs";
import "@/presentation/openapi/endpoints/product-category.docs";
import "@/presentation/openapi/endpoints/product.docs";
import "@/presentation/openapi/endpoints/order.docs";
import "@/presentation/openapi/endpoints/payment.docs";
import "@/presentation/openapi/endpoints/user.docs";

let cached: ReturnType<OpenApiGeneratorV31["generateDocument"]> | undefined;

export function buildOpenApiDocument() {
  cached ??= new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "express-fnb API", version: "1.0.0" },
    servers: [{ url: "/" }],
  });
  return cached;
}
