import { ProductCategoryStatus } from "@/domain/types/product-category.type";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import {
  BEARER,
  commonErrors,
  dateTime,
  errorResponse,
  issue,
  jsonBody,
  roleForbidden,
  successResponse,
  tooManyRequests,
  validationError,
  validationFailed,
} from "@/presentation/openapi/shared";
import {
  BrowseProductCategoriesSchema,
  CreateProductCategorySchema,
  GetProductCategoryDetailSchema,
  ReorderProductCategoriesSchema,
  UpdateProductCategorySchema,
} from "@/presentation/validation/schemas/product-category.schemas";

const TAG = "Product Categories";

// ============================================================================
// Reusable error responses for this router
// ============================================================================

const categoryNotFound = errorResponse("Product category not found", E.ProductCategoryNotFoundError);

// ============================================================================
// Response data shapes
//
// Shapes follow ProductCategoryMapper: browse returns the summary view,
// get-by-id returns the full plain object.
// ============================================================================

const ProductCategorySummarySchema = z
  .object({
    id: z.uuid().openapi({ example: "0b8f6c1e-5a3d-4e7b-9c21-8f4d2a6b1e90" }),
    name: z.string().openapi({ example: "Beverages" }),
    status: z.enum(Object.values(ProductCategoryStatus)),
    imageUrl: z.string().nullable().optional().openapi({ example: "https://example.com/images/beverages.jpg" }),
    sortOrder: z.number().int().openapi({ example: 0 }),
    createdAt: dateTime("2026-10-01T08:00:00.000Z"),
  })
  .openapi("ProductCategorySummary");

const ProductCategoryDetailSchema = z
  .object({
    id: z.uuid().openapi({ example: "0b8f6c1e-5a3d-4e7b-9c21-8f4d2a6b1e90" }),
    name: z.string().openapi({ example: "Beverages" }),
    description: z.string().nullable().optional().openapi({ example: "Cold and hot drinks" }),
    status: z.enum(Object.values(ProductCategoryStatus)),
    sortOrder: z.number().int().openapi({ example: 0 }),
    imageUrl: z.string().nullable().optional().openapi({ example: "https://example.com/images/beverages.jpg" }),
    createdAt: dateTime("2026-10-01T08:00:00.000Z"),
    updatedAt: dateTime("2026-10-15T09:30:00.000Z"),
  })
  .openapi("ProductCategoryDetail");

const ProductCategoryIdDataSchema = z
  .object({
    id: z.uuid().openapi({ example: "0b8f6c1e-5a3d-4e7b-9c21-8f4d2a6b1e90" }),
  })
  .openapi("ProductCategoryIdData");

// ============================================================================
// Multipart request bodies
//
// The validation schemas describe `image` as the internal payload built by the
// controller from multer ({ fileName, fileBuffer, ... }). Clients send a plain
// file in the `image` form field, so we swap that one field for a binary file.
// The other fields (and their rules) stay in sync with the validation schemas.
// ============================================================================

const ImageFileSchema = z
  .string()
  .openapi({
    format: "binary",
    description: "Image file (any `image/*` type, at most 1 MB), sent in the `image` form field.",
  })
  .optional();

const CreateProductCategoryBodySchema = CreateProductCategorySchema.omit({ image: true }).extend({ image: ImageFileSchema });

const UpdateProductCategoryBodySchema = UpdateProductCategorySchema.omit({ id: true, image: true }).extend({ image: ImageFileSchema });

const multipartBody = (schema: z.ZodType, example: unknown) => ({
  required: true,
  content: { "multipart/form-data": { schema, example } },
});

// ============================================================================
// GET /product-categories/browse
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/product-categories/browse",
  summary: "List product categories",
  description: "Public. Optionally filter by status and choose the sort order (default: by sort order, ascending).",
  tags: [TAG],
  request: { query: BrowseProductCategoriesSchema },
  responses: {
    200: successResponse("Product categories", "Product categories retrieved successfully", z.array(ProductCategorySummarySchema)),
    400: validationFailed(issue.oneOf("status", Object.values(ProductCategoryStatus))),
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /product-categories/{id}
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/product-categories/{id}",
  summary: "Get a product category",
  description: "Public.",
  tags: [TAG],
  request: { params: GetProductCategoryDetailSchema },
  responses: {
    200: successResponse("Product category", "Product category details retrieved successfully", ProductCategoryDetailSchema),
    400: validationFailed(issue.uuid("id")),
    404: categoryNotFound,
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /product-categories
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/product-categories",
  summary: "Create a product category",
  description:
    "Requires the ADMIN or MANAGER role. Sent as multipart/form-data so an image can be attached. The new category is placed last in the sort order.",
  tags: [TAG],
  security: BEARER,
  request: {
    body: multipartBody(CreateProductCategoryBodySchema, {
      name: "Beverages",
      description: "Cold and hot drinks",
    }),
  },
  responses: {
    201: successResponse("Product category created", "Product category created successfully", ProductCategoryIdDataSchema),
    400: validationFailed(issue.required("name")),
    401: commonErrors.unauthorized,
    403: roleForbidden("create product categories", "ADMIN and MANAGER", "CASHIER"),
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /product-categories/reorder
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/product-categories/reorder",
  summary: "Reorder product categories",
  description: "Requires the ADMIN or MANAGER role. The list must contain every category, including inactive ones, each with a unique sort order.",
  tags: [TAG],
  security: BEARER,
  request: {
    body: jsonBody(ReorderProductCategoriesSchema, {
      categories: [
        { id: "0b8f6c1e-5a3d-4e7b-9c21-8f4d2a6b1e90", sortOrder: 0 },
        { id: "7d2e9a40-1c3b-4f58-a6d7-3b9e0c5f8a12", sortOrder: 1 },
      ],
    }),
  },
  responses: {
    200: successResponse("Categories reordered", "Product categories reordered successfully"),
    400: errorResponse(
      "Validation failed, the list is incomplete, or it contains an unknown category",
      validationError(issue.required("categories", "array")),
      E.ProductCategoryIncompleteReorderListError,
      E.UnknownProductCategoryInReorderError,
    ),
    401: commonErrors.unauthorized,
    403: roleForbidden("update product categories", "ADMIN and MANAGER", "CASHIER"),
    409: errorResponse("Two categories share the same sort order", E.ProductCategoryDuplicateSortOrderError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /product-categories/{id}
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/product-categories/{id}",
  summary: "Update a product category",
  description:
    "Requires the ADMIN or MANAGER role. Send only the fields you want to change, as multipart/form-data. A new image replaces the old one.",
  tags: [TAG],
  security: BEARER,
  request: {
    params: GetProductCategoryDetailSchema,
    body: multipartBody(UpdateProductCategoryBodySchema, {
      name: "Drinks",
      description: "Cold and hot drinks",
    }),
  },
  responses: {
    200: successResponse("Product category updated", "Product category updated successfully", ProductCategoryIdDataSchema),
    400: validationFailed(issue.uuid("id")),
    401: commonErrors.unauthorized,
    403: roleForbidden("update product categories", "ADMIN and MANAGER", "CASHIER"),
    404: categoryNotFound,
    429: tooManyRequests(),
  },
});
