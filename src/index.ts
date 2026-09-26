import { Hono } from "hono";
import { barcodeJpeg, barcodeSvg } from "./barcode";
import {
  createTicketIdentity,
  InputError,
  isBarcodeId,
  objectKey,
  positiveInt,
  publicObjectUrl,
  validateTicketInput,
} from "./ticket";
import type { Bindings } from "./types";
import { page } from "./ui";

const app = new Hono<{ Bindings: Bindings }>();
const NO_STORE = { "Cache-Control": "no-store" };
const DEFAULT_EDGE_TTL = 14_400;
const DEFAULT_BROWSER_TTL = 0;
const R2_CACHE_BEHAVIORS = ["default", "no-store"] as const;
type R2CacheBehavior = (typeof R2_CACHE_BEHAVIORS)[number];

function cacheControl(env: Bindings): string {
  const browser = positiveInt(env.BROWSER_CACHE_TTL_SECONDS, DEFAULT_BROWSER_TTL);
  const edge = positiveInt(env.EDGE_CACHE_TTL_SECONDS, DEFAULT_EDGE_TTL);
  return `public, max-age=${browser}, s-maxage=${edge}, immutable`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Unexpected error.";
}

function isLocalRequest(requestUrl: string): boolean {
  const hostname = new URL(requestUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function parseIdentity(request: Request, env: Bindings) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2048) throw new InputError("Request body is too large.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InputError("Request body must be valid JSON.");
  }
  return createTicketIdentity(validateTicketInput(body), env.TICKET_HMAC_SECRET);
}

function r2CacheBehavior(value: unknown): R2CacheBehavior {
  if (value === undefined || value === "default") return "default";
  if (value === "no-store") return value;
  throw new InputError(`Cache behavior must be one of: ${R2_CACHE_BEHAVIORS.join(", ")}.`);
}

app.onError((error, c) => {
  console.error("Request failed", errorMessage(error));
  const status = error instanceof InputError ? 400 : 500;
  return c.json({ error: errorMessage(error) }, status, NO_STORE);
});

app.get("/", (c) => c.html(page, 200, {
  "Cache-Control": "no-store, max-age=0",
  "Clear-Site-Data": '"cache"',
  "X-POC-Build": "qr-v2-edge-diagnostics-v2",
}));
app.get("/health", (c) => c.json({ ok: true }, 200, NO_STORE));

app.post("/api/svg-tickets", async (c) => {
  const { barcodeId } = await parseIdentity(c.req.raw, c.env);
  const imageUrl = new URL(`/tickets/edge/v2/${barcodeId}`, c.req.url).toString();
  return c.json({ barcodeId, imageUrl }, 200, NO_STORE);
});

app.get("/tickets/edge/v2/:barcodeId", async (c) => {
  const barcodeId = c.req.param("barcodeId");
  if (!isBarcodeId(barcodeId)) return c.json({ error: "Invalid barcode ID." }, 400, NO_STORE);

  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = "";
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("X-POC-Cache-Status", "HIT");
    const cachedAt = Number(response.headers.get("X-POC-Cached-At"));
    const cacheAge = Number.isFinite(cachedAt)
      ? Math.max(0, Math.floor((Date.now() - cachedAt) / 1000))
      : 0;
    response.headers.set("X-POC-Cache-Age", String(cacheAge));
    return response;
  }

  const cachedAt = Date.now();
  const response = new Response(barcodeSvg(barcodeId), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheControl(c.env),
      "ETag": `"${barcodeId}-qr-svg-v2"`,
      "X-Content-Type-Options": "nosniff",
      "X-POC-Cached-At": String(cachedAt),
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  response.headers.set("X-POC-Cache-Status", "MISS");
  response.headers.set("X-POC-Cache-Age", "0");
  return response;
});

app.post("/api/r2-tickets", async (c) => {
  if (!c.env.TICKET_BUCKET) throw new Error("TICKET_BUCKET binding is not configured.");
  const requestBody: Record<string, unknown> = await c.req.raw.clone().json<Record<string, unknown>>().catch(() => ({}));
  const { barcodeId } = await parseIdentity(c.req.raw, c.env);
  const cacheBehavior = r2CacheBehavior(requestBody.cacheBehavior);
  const selectedCacheControl = cacheBehavior === "no-store" ? "no-store" : cacheControl(c.env);
  const key = objectKey(c.env.R2_OBJECT_PREFIX, barcodeId);
  const existing = await c.env.TICKET_BUCKET.head(key);
  let created = false;
  const metadataUpdated = Boolean(existing && existing.httpMetadata?.cacheControl !== selectedCacheControl);

  if (!existing || metadataUpdated) {
    const jpeg = barcodeJpeg(barcodeId);
    await c.env.TICKET_BUCKET.put(key, jpeg, {
      httpMetadata: {
        contentType: "image/jpeg",
        cacheControl: selectedCacheControl,
        contentDisposition: `inline; filename="${barcodeId}.jpg"`,
      },
      customMetadata: { barcodeId, formatVersion: "v2", barcodeFormat: "qr" },
    });
    created = true;
  }

  const previewUrl = isLocalRequest(c.req.url)
    ? new URL(`/local/r2-preview/${barcodeId}.jpg`, c.req.url).toString()
    : undefined;
  return c.json(
    {
      barcodeId,
      imageUrl: publicObjectUrl(c.env.R2_PUBLIC_BASE_URL, key),
      previewUrl,
      objectKey: key,
      created,
      metadataUpdated,
      cacheBehavior,
      cacheControl: selectedCacheControl,
    },
    created ? 201 : 200,
    NO_STORE,
  );
});

app.get("/api/r2-cache-diagnostics/:file", async (c) => {
  const file = c.req.param("file");
  const barcodeId = file.endsWith(".jpg") ? file.slice(0, -4) : "";
  if (!isBarcodeId(barcodeId)) return c.json({ error: "Invalid barcode ID." }, 400, NO_STORE);

  const key = objectKey(c.env.R2_OBJECT_PREFIX, barcodeId);
  const imageUrl = publicObjectUrl(c.env.R2_PUBLIC_BASE_URL, key);
  const response = await fetch(imageUrl, {
    method: "GET",
    headers: { "User-Agent": "ticket-cache-poc-diagnostics/1.0" },
  });
  // Cancel the body once headers arrive. This endpoint measures the CDN request
  // without proxying the image through the application Worker.
  await response.body?.cancel();

  const cacheStatus = response.headers.get("CF-Cache-Status") || "UNAVAILABLE";
  const cacheServed = ["HIT", "STALE", "UPDATING", "REVALIDATED"].includes(cacheStatus);
  const source = cacheServed
    ? "Cloudflare cache"
    : cacheStatus === "MISS"
      ? "R2 origin (cache miss)"
      : cacheStatus === "BYPASS" || cacheStatus === "DYNAMIC"
        ? "R2 origin (cache bypassed)"
        : response.ok ? "Unknown" : "Error response";

  return c.json({
    checkedUrl: imageUrl,
    checkedAt: new Date().toISOString(),
    httpStatus: response.status,
    source,
    headers: {
      cfCacheStatus: cacheStatus,
      age: response.headers.get("Age"),
      cacheControl: response.headers.get("Cache-Control"),
      etag: response.headers.get("ETag"),
      contentType: response.headers.get("Content-Type"),
      cfRay: response.headers.get("CF-Ray"),
      lastModified: response.headers.get("Last-Modified"),
    },
  }, 200, NO_STORE);
});

// Local-only bridge to Wrangler's simulated R2. The public R2 custom-domain
// URL cannot see objects stored by `wrangler dev`, so the browser uses this
// route for its preview while still displaying the real deployment URL.
app.get("/local/r2-preview/:file", async (c) => {
  if (!isLocalRequest(c.req.url)) return c.notFound();
  const file = c.req.param("file");
  const barcodeId = file.endsWith(".jpg") ? file.slice(0, -4) : "";
  if (!isBarcodeId(barcodeId)) return c.json({ error: "Invalid barcode ID." }, 400, NO_STORE);

  const object = await c.env.TICKET_BUCKET.get(objectKey(c.env.R2_OBJECT_PREFIX, barcodeId));
  if (!object) return c.json({ error: "Local R2 object not found." }, 404, NO_STORE);
  const headers = new Headers(NO_STORE);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});

app.notFound((c) => c.json({ error: "Not found." }, 404, NO_STORE));

export default app;
