import { Router } from "express";
import { buildOpenApiDocument } from "../openapi/generator";

const router = Router();

router.get("/openapi.json", (_req, res) => {
  res.json(buildOpenApiDocument());
});

router.get("/", (_req, res) => {
  res.send(`<!doctype html>
<html>
  <head><title>API Docs</title><meta charset="utf-8" /></head>
  <body>
    <script id="api-reference" data-url="/docs/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});

export default router;
