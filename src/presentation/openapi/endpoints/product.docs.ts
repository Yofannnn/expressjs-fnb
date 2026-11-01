import { ProductStatus, ProductType } from "@/domain/types/product.type";
import { UpdateProductImageAction } from "@/application/ports/driving/update-product-image.use-case.port";
import { z } from "zod";
import * as E from "@/presentation/openapi/errors.docs";
import { registry } from "@/presentation/openapi/registry";
import {
  BEARER,
  EXAMPLE_CATEGORY_ID,
  EXAMPLE_PRODUCT_ID,
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
  BrowseProductsSchema,
  CreateProductSchema,
  GetProductDetailsSchema,
  SearchProductsSchema,
  UpdateProductSchema,
  UpdateProductStatusSchema,
  UpdateProductStockSchema,
} from "@/presentation/validation/schemas/product.schemas";

const TAG = "Products";

const FIRST_TYPE = Object.values(ProductType)[0];
const FIRST_STATUS = Object.values(ProductStatus)[0];

// ============================================================================
// Reusable error responses for this router
// ============================================================================

const productNotFound = errorResponse("Product not found", E.ProductNotFoundError);

// ============================================================================
// Response data shapes
//
// Shapes follow ProductMapper:
//   browse + search -> toSummaryView   ("ProductSummary")
//   get by id       -> toDetailView    ("ProductDetail")
//   by-ids          -> toPlainObject   ("Product")
// Objects are built from shared field groups instead of .extend(), so each
// registered schema keeps its own name.
// ============================================================================

const productImageShape = {
  url: z.string().openapi({ example: "https://example.com/images/nasi-goreng-1.jpg" }),
  altText: z.string().nullable().optional().openapi({ example: "Plate of fried rice" }),
  isPrimary: z.boolean().openapi({ example: true }),
  sortOrder: z.number().int().openapi({ example: 0 }),
};

const ProductImageSchema = z.object(productImageShape).openapi("ProductImage");

const ProductImageRecordSchema = z
  .object({
    productId: z.uuid().openapi({ example: EXAMPLE_PRODUCT_ID }),
    ...productImageShape,
  })
  .openapi("ProductImageRecord");

const ProductCategoryReferenceSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_CATEGORY_ID }),
    name: z.string().openapi({ example: "Main Course" }),
    description: z.string().nullable().optional().openapi({ example: "Rice and noodle dishes" }),
    imageUrl: z.string().nullable().optional().openapi({ example: "https://example.com/images/main-course.jpg" }),
  })
  .openapi("ProductCategoryReference");

const productCommonShape = {
  id: z.uuid().openapi({ example: EXAMPLE_PRODUCT_ID }),
  name: z.string().openapi({ example: "Nasi Goreng Spesial" }),
  price: z.number().openapi({ example: 25000 }),
  description: z.string().nullable().optional().openapi({ example: "Fried rice with egg and chicken" }),
  type: z.enum(Object.values(ProductType)),
  ingredients: z.string().nullable().optional().openapi({ example: "Rice, egg, chicken, soy sauce" }),
  preparationTimeInMinutes: z.number().int().nullable().optional().openapi({ example: 15 }),
  stockQuantity: z.number().int().nullable().optional().openapi({ example: 50 }),
  status: z.enum(Object.values(ProductStatus)),
  createdAt: dateTime("2026-10-01T08:00:00.000Z"),
  updatedAt: dateTime("2026-10-15T09:30:00.000Z"),
};

const ProductSummarySchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PRODUCT_ID }),
    name: z.string().openapi({ example: "Nasi Goreng Spesial" }),
    price: z.number().openapi({ example: 25000 }),
    categoryId: z.string().openapi({ example: EXAMPLE_CATEGORY_ID }),
    primaryImageUrl: z.string().openapi({ example: "https://example.com/images/nasi-goreng-1.jpg" }),
    status: z.enum(Object.values(ProductStatus)),
  })
  .openapi("ProductSummary");

const ProductDetailSchema = z
  .object({
    ...productCommonShape,
    images: z.array(ProductImageSchema),
    category: ProductCategoryReferenceSchema,
  })
  .openapi("ProductDetail");

const ProductSchema = z
  .object({
    ...productCommonShape,
    categoryId: z.string().openapi({ example: EXAMPLE_CATEGORY_ID }),
    images: z.array(ProductImageRecordSchema),
  })
  .openapi("Product");

const ProductIdDataSchema = z
  .object({
    id: z.uuid().openapi({ example: EXAMPLE_PRODUCT_ID }),
  })
  .openapi("ProductIdData");

/** `{ message, data: item[], ...extras }`. These endpoints put extras next to `data`, not inside it. */
function productListResponse(description: string, message: string, item: z.ZodType, extras: Record<string, z.ZodType>) {
  return {
    description,
    content: {
      "application/json": {
        schema: z.object({
          message: z.string().openapi({ example: message }),
          data: z.array(item),
          ...extras,
        }),
      },
    },
  };
}

// ============================================================================
// Request bodies
//
// The validation schemas describe uploaded files as the internal payload built
// by the controller from multer ({ fileName, fileBuffer, ... }). Clients send
// plain files, so file fields are swapped for binary fields here. All other
// fields (and their rules) stay in sync with the validation schemas.
// ============================================================================

const ImageFileSchema = z.string().openapi({
  format: "binary",
  description: "Image file (any `image/*` type, at most 1 MB).",
});

const CreateProductBodySchema = CreateProductSchema.omit({ images: true }).extend({
  images: z
    .array(ImageFileSchema)
    .min(1)
    .max(10)
    .openapi({ description: "Product images, 1 to 10 files. Repeat the `images` form field for each file." }),
});

const UpdateProductBodySchema = UpdateProductSchema.omit({ id: true });
const UpdateProductStockBodySchema = UpdateProductStockSchema.omit({ id: true });
const UpdateProductStatusBodySchema = UpdateProductStatusSchema.omit({ id: true });

// PATCH /products/{id}/images: the validation schema is a union with transforms, so each action is described by its own plain schema.
const AddProductImageRequestSchema = z
  .object({
    action: z.literal(UpdateProductImageAction.ADD),
    image: ImageFileSchema,
  })
  .openapi("AddProductImageRequest");

const ReplaceProductImageRequestSchema = z
  .object({
    action: z.literal(UpdateProductImageAction.REPLACE),
    oldImageUrl: z.url().openapi({ description: "URL of the image to replace." }),
    image: ImageFileSchema,
  })
  .openapi("ReplaceProductImageRequest");

const RemoveProductImageRequestSchema = z
  .object({
    action: z.literal(UpdateProductImageAction.REMOVE),
    imageUrl: z.url().openapi({ description: "URL of the image to remove." }),
  })
  .openapi("RemoveProductImageRequest");

const ReorderProductImagesRequestSchema = z
  .object({
    action: z.literal(UpdateProductImageAction.REORDER),
    reorderedUrls: z.array(z.url()).min(1).openapi({ description: "All of the product's image URLs, in the new order." }),
  })
  .openapi("ReorderProductImagesRequest");

// ============================================================================
// GET /products/by-ids
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/products/by-ids",
  summary: "Get several products by id",
  description: "Public. Ids that don't exist are listed in `notFoundIds` instead of failing the request.",
  tags: [TAG],
  request: {
    query: z.object({
      id: z.array(z.uuid()).min(1).openapi({ description: "Product id. Repeat the parameter for each product: `?id=<id1>&id=<id2>`." }),
    }),
  },
  responses: {
    200: productListResponse("Products found", "Products retrieved successfully", ProductSchema, {
      notFoundIds: z.array(z.uuid()).openapi({ description: "Requested ids that don't exist." }),
    }),
    400: validationFailed(issue.uuid("id.0")),
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /products/browse
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/products/browse",
  summary: "Browse products",
  description: "Public. Filter by category, type, status or price range, then page through results with `cursor` and `limit`.",
  tags: [TAG],
  request: { query: BrowseProductsSchema },
  responses: {
    200: productListResponse("A page of products", "Products retrieved successfully", ProductSummarySchema, {
      nextCursor: z
        .string()
        .nullable()
        .optional()
        .openapi({ description: "Pass this as `cursor` to get the next page. Empty when there are no more pages." }),
    }),
    400: validationFailed(issue.oneOf("type", Object.values(ProductType)), issue.oneOf("status", Object.values(ProductStatus))),
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /products/search
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/products/search",
  summary: "Search products by keyword",
  description: "Public.",
  tags: [TAG],
  request: { query: SearchProductsSchema },
  responses: {
    200: productListResponse("Matching products", "Products retrieved successfully", ProductSummarySchema, {
      total: z.number().int().openapi({ example: 1, description: "Number of matching products." }),
    }),
    400: validationFailed(issue.required("keyword")),
    429: tooManyRequests(),
  },
});

// ============================================================================
// GET /products/{id}
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/products/{id}",
  summary: "Get a product",
  description: "Public. Includes the product's images and its category.",
  tags: [TAG],
  request: { params: GetProductDetailsSchema },
  responses: {
    200: successResponse("Product details", "Product details retrieved successfully", ProductDetailSchema),
    400: validationFailed(issue.uuid("id")),
    404: productNotFound,
    429: tooManyRequests(),
  },
});

// ============================================================================
// POST /products
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/products",
  summary: "Create a product",
  description:
    "Requires the ADMIN or MANAGER role. Sent as multipart/form-data because images are uploaded with it. The category must exist and be active.",
  tags: [TAG],
  security: BEARER,
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: CreateProductBodySchema,
          example: {
            categoryId: EXAMPLE_CATEGORY_ID,
            name: "Nasi Goreng Spesial",
            description: "Fried rice with egg and chicken",
            price: 25000,
            type: FIRST_TYPE,
            stockQuantity: 50,
            ingredients: "Rice, egg, chicken, soy sauce",
            preparationTimeInMinutes: 15,
          },
        },
      },
    },
  },
  responses: {
    201: successResponse("Product created", "Product created successfully", ProductIdDataSchema),
    400: errorResponse(
      "Validation failed, no image was attached, or the category is inactive",
      validationError(issue.required("name"), issue.required("price", "number")),
      E.ProductWithoutImageError,
      E.ProductCategoryInactiveError,
      E.InvalidStockQuantityError,
      E.InvalidPreparationTimeError,
    ),
    401: commonErrors.unauthorized,
    403: roleForbidden("create products", "ADMIN and MANAGER", "CASHIER"),
    404: errorResponse("Product category not found", E.ProductCategoryNotFoundError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /products/{id}
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/products/{id}",
  summary: "Update a product",
  description: "Requires the ADMIN or MANAGER role. Send only the fields you want to change. Status, stock and images have their own endpoints.",
  tags: [TAG],
  security: BEARER,
  request: {
    params: GetProductDetailsSchema,
    body: jsonBody(UpdateProductBodySchema, { name: "Nasi Goreng Spesial", price: 28000 }),
  },
  responses: {
    200: successResponse("Product updated", "Product updated successfully", ProductIdDataSchema),
    400: errorResponse("Validation failed", validationError(issue.uuid("id")), E.InvalidPreparationTimeError),
    401: commonErrors.unauthorized,
    403: roleForbidden("update products", "ADMIN and MANAGER", "CASHIER"),
    404: productNotFound,
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /products/{id}/stock
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/products/{id}/stock",
  summary: "Change a product's stock",
  description:
    "Requires the ADMIN, MANAGER or CASHIER role. Send exactly one of `restock` (add), `deductStock` (subtract) or `setStock` (overwrite).",
  tags: [TAG],
  security: BEARER,
  request: {
    params: GetProductDetailsSchema,
    body: jsonBody(UpdateProductStockBodySchema, { restock: 20 }),
  },
  responses: {
    200: successResponse("Stock updated", "Product stock updated successfully", ProductIdDataSchema),
    400: errorResponse(
      "Validation failed, or none of the stock fields was sent",
      validationError(issue.uuid("id")),
      E.NoProductStockOperationError,
      E.InvalidRestockQuantityError,
      E.InvalidDeductQuantityError,
      E.InvalidStockQuantityError,
    ),
    401: commonErrors.unauthorized,
    403: roleForbidden("manage product stock", "ADMIN, MANAGER and CASHIER", "KITCHEN"),
    404: productNotFound,
    409: errorResponse("More than one stock field was sent", E.ConflictingProductStockOperationError),
    422: errorResponse("Not enough stock to deduct", E.InsufficientStockError),
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /products/{id}/status
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/products/{id}/status",
  summary: "Change a product's status",
  description: "Requires the ADMIN or MANAGER role.",
  tags: [TAG],
  security: BEARER,
  request: {
    params: GetProductDetailsSchema,
    body: jsonBody(UpdateProductStatusBodySchema, { setStatus: FIRST_STATUS }),
  },
  responses: {
    200: successResponse("Status updated", "Product status updated successfully", ProductIdDataSchema),
    400: validationFailed(issue.oneOf("setStatus", Object.values(ProductStatus))),
    401: commonErrors.unauthorized,
    403: roleForbidden("update products", "ADMIN and MANAGER", "CASHIER"),
    404: productNotFound,
    429: tooManyRequests(),
  },
});

// ============================================================================
// PATCH /products/{id}/images
// ============================================================================

registry.registerPath({
  method: "patch",
  path: "/products/{id}/images",
  summary: "Add, replace, remove or reorder a product's images",
  description:
    "Requires the ADMIN or MANAGER role. `action` decides what to do. Actions that upload a file (ADD, REPLACE) are sent as multipart/form-data with the file in the `image` field. REMOVE and REORDER need no file and are sent as JSON.",
  tags: [TAG],
  security: BEARER,
  request: {
    params: GetProductDetailsSchema,
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.discriminatedUnion("action", [AddProductImageRequestSchema, ReplaceProductImageRequestSchema]),
        },
        "application/json": {
          schema: z.discriminatedUnion("action", [RemoveProductImageRequestSchema, ReorderProductImagesRequestSchema]),
          example: {
            action: UpdateProductImageAction.REORDER,
            reorderedUrls: ["https://example.com/images/nasi-goreng-2.jpg", "https://example.com/images/nasi-goreng-1.jpg"],
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Images updated", "Product image updated successfully", ProductIdDataSchema),
    400: errorResponse(
      "Validation failed, the reorder list is empty or doesn't match the product's images, or the last image can't be removed",
      validationError(issue.uuid("id")),
      E.NoReorderProductImageOperationError,
      E.InvalidReorderProductImageError,
      E.ProductWithoutImageError,
    ),
    401: commonErrors.unauthorized,
    403: roleForbidden("update products", "ADMIN and MANAGER", "CASHIER"),
    404: errorResponse("Product or image not found", E.ProductNotFoundError, E.ProductImageNotFoundError),
    429: tooManyRequests(),
  },
});
