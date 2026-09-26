# Ticket System POC Requirements

## 1. Purpose

Build a small ticket barcode application on Cloudflare Workers to validate two different Cloudflare delivery paths:

1. Generate an SVG ticket on demand and store it with the Workers Cache API for later requests at the same edge location.
2. Pre-generate a JPEG ticket, store it in R2, and serve it through an R2 custom domain with Cloudflare Cache and Smart Tiered Cache enabled.

The application is a proof of concept, not a production ticketing or admission-control system. Keep the UI, API surface, and deployment architecture minimal.

## 2. Technology and Deployment

- Language: TypeScript
- Web framework: Hono
- Runtime: Cloudflare Workers
- Object storage: Cloudflare R2 through a Worker binding
- UI: Server-hosted static HTML/CSS/JavaScript; no separate frontend framework is required
- Secrets: Store the HMAC secret as a Worker secret, never in source code or client-side JavaScript
- R2 public URL: Configure the R2 custom-domain base URL through a Worker environment variable

Suggested bindings and variables:

```text
TICKET_BUCKET          R2 binding
TICKET_HMAC_SECRET     Worker secret
R2_PUBLIC_BASE_URL     Environment variable, for example https://tickets.example.com
CACHE_TTL_SECONDS      Optional environment variable with a sensible POC default
```

## 3. Shared Ticket Rules

### 3.1 Inputs

Both features accept:

- User ID: required, trimmed, non-empty string
- Ticket ID: required, trimmed, non-empty string

The backend must validate both fields and enforce a small maximum length, such as 128 UTF-8 bytes per field. The UI must display validation and request errors.

### 3.2 Barcode ID

Use HMAC-SHA-256 with `TICKET_HMAC_SECRET`. Do not concatenate the two values without boundaries, because values such as `ab` + `c` and `a` + `bc` would otherwise be ambiguous.

For this POC, calculate the ID from a canonical length-prefixed message:

```text
message = utf8ByteLength(userId) + ":" + userId + utf8ByteLength(ticketId) + ":" + ticketId
barcodeId = lowercaseHex(HMAC-SHA-256(secret, message))
```

The same normalized inputs must always produce the same 64-character barcode ID in both tabs. Use the Web Crypto API available in Workers.

### 3.3 Barcode Format

- Barcode symbology: QR Code with medium error correction
- Encoded value: the complete barcode ID
- Human-readable text: display the complete barcode ID below the bars and in the UI preview area
- Use a Worker-compatible barcode/image package with no Node.js native dependency

QR Code is used because the 64-character HMAC would produce an excessively wide linear barcode. Both SVG and JPEG renderers use the same QR matrix and retain the complete human-readable ID underneath.

## 4. User Interface

Expose one page with two tabs:

- **Edge SVG**
- **R2 JPEG**

Each tab contains:

- User ID input
- Ticket ID input
- Action button
- Full, clickable image URL
- Barcode ID text
- Image preview below the form
- Loading state and readable error state
- Cache diagnostic values returned by the relevant endpoint

The layout only needs to be clean and usable on desktop and mobile. Accessibility basics are required: explicit labels, keyboard-operable tabs and buttons, and useful image alternative text.

## 5. Feature 1: On-Demand SVG with Workers Cache API

### 5.1 User Flow

1. The user enters a User ID and Ticket ID in the **Edge SVG** tab.
2. The user selects **Get**.
3. The backend computes the barcode ID and returns an immutable SVG URL.
4. The UI loads that URL in the preview.
5. On the first image request at an edge location, the Worker generates the SVG and writes it to `caches.default`.
6. Follow-up requests at that edge location are served from the Cache API until expiry.

### 5.2 Proposed Endpoints

```text
POST /api/svg-tickets
Body: { "userId": "...", "ticketId": "..." }
Response: { "barcodeId": "...", "imageUrl": "https://.../tickets/edge/v2/{barcodeId}" }

GET /tickets/edge/v2/:barcodeId
Response: image/svg+xml
```

The POST keeps raw user and ticket identifiers out of the public preview URL. The immutable GET URL contains only the derived barcode ID and is the Cache API key.

### 5.3 Cache Behavior

For `GET /tickets/edge/v2/:barcodeId`:

- Reject malformed IDs; only accept exactly 64 lowercase hexadecimal characters.
- Call `caches.default.match()` using a normalized HTTPS request URL.
- On a hit, return the cached response with `X-POC-Cache-Status: HIT`.
- On a miss, generate the SVG, set an explicit shared cache policy, return `X-POC-Cache-Status: MISS`, and store a clone with `executionCtx.waitUntil(caches.default.put(...))`.
- Suggested response policy: `Cache-Control: public, max-age=0, s-maxage=<CACHE_TTL_SECONDS>, immutable`.
- The cache key must not vary by cookies, authorization headers, or irrelevant query parameters.

The SVG generator needs only the barcode ID, so a cache miss can regenerate the same content without retaining the original User ID or Ticket ID.

### 5.4 Important Scope Limitation

The Workers Cache API is local to a Cloudflare data center. `cache.put()` does **not** populate or use Tiered Cache. This feature validates explicit Cache API behavior and same-edge reuse only; it must not be described as a Tiered Cache test. Cache API behavior must be tested on a Worker custom domain or route, not a local development server, Playground, or `workers.dev` preview.

## 6. Feature 2: Pre-Generated JPEG in R2

### 6.1 User Flow

1. The user enters a User ID and Ticket ID in the **R2 JPEG** tab.
2. The user selects **Generate**.
3. The backend computes the same barcode ID used by Feature 1.
4. The backend creates a JPEG barcode and uploads it through the `TICKET_BUCKET` R2 binding.
5. The object key is `<configured-prefix>/v2/{barcodeId}.jpg`.
6. The response includes the full URL based on `R2_PUBLIC_BASE_URL`.
7. The UI loads the custom-domain URL in the preview, causing Cloudflare Cache to fetch the object from R2 on a miss.

### 6.2 Proposed Endpoint

```text
POST /api/r2-tickets
Body: { "userId": "...", "ticketId": "..." }
Response: {
  "barcodeId": "...",
  "imageUrl": "https://<configured-r2-domain>/<configured-prefix>/v2/{barcodeId}.jpg",
  "objectKey": "<configured-prefix>/v2/{barcodeId}.jpg"
}
```

### 6.3 R2 Object Requirements

- Content type: `image/jpeg`
- Cache metadata: an explicit long-lived public `Cache-Control` value suitable for immutable content
- Object name: `<configured-prefix>/v2/{barcodeId}.jpg`
- A repeated generation request for the same normalized inputs is idempotent. It may skip image generation when the object already exists, or overwrite it with identical content. Prefer skipping unnecessary work.
- The API response must use the configured custom-domain base URL, not an `r2.dev` URL and not a Worker-proxied URL.

### 6.4 Cloudflare Cache Configuration

The R2 bucket must have a custom domain in the same Cloudflare account. Configure that hostname so that:

- JPEG objects are eligible for Cloudflare Cache.
- Smart Tiered Cache is enabled for the R2 origin.
- Query strings do not create accidental cache variants for these immutable URLs.
- `CF-Cache-Status` and `Age` can be inspected on repeated image requests.

The UI should show browser-visible `CF-Cache-Status` and `Age` when available. Because JavaScript cannot read those cross-origin headers unless they are exposed through CORS, the POC may also provide a small same-origin diagnostic endpoint that performs a `HEAD` or `GET` to the R2 custom-domain URL and returns selected cache headers. The image itself must still be loaded directly from the R2 custom domain.

## 7. Cache Verification Scenarios

### 7.1 Feature 1

1. Request a new SVG URL and confirm `X-POC-Cache-Status: MISS`.
2. Request the identical URL again from the same location and confirm `X-POC-Cache-Status: HIT`.
3. Confirm a different barcode ID has an independent cache entry.
4. Confirm malformed IDs are rejected and are not cached.

### 7.2 Feature 2

1. Generate a new JPEG and confirm the object exists at the displayed R2 custom-domain URL.
2. Request the identical URL repeatedly and inspect `CF-Cache-Status` and `Age`.
3. Test from more than one geographic location to observe lower-tier and Smart Tiered Cache behavior.
4. Confirm a different barcode ID maps to a different immutable object URL.
5. Confirm JPEG content type, object cache metadata, barcode readability, and displayed barcode text.

Cache tests should use deployed hostnames and command-line requests or browser cache disabled where appropriate. A browser's own HTTP cache can otherwise hide requests from Cloudflare and produce misleading results.

## 8. Security and Privacy Boundaries

- Never return or log `TICKET_HMAC_SECRET`.
- Do not include raw User IDs or Ticket IDs in image URLs, R2 object keys, cache keys, or normal application logs.
- Treat the barcode ID as a stable pseudonymous identifier, not encryption; it may still be sensitive and shareable.
- Use HTTPS only.
- Escape all user-controlled text rendered in HTML.
- Apply basic body-size and input-length limits.
- The POC does not implement authentication, authorization, ticket revocation, replay protection, admission validation, rate limiting, or key rotation. These are explicitly out of scope.

## 9. Error Handling

Return compact JSON errors for API failures with an appropriate HTTP status. Cover at least:

- Missing or invalid input
- Missing configuration or binding
- Barcode/image generation failure
- Cache operation failure
- R2 upload failure

A Cache API write failure may be logged while still returning the generated SVG. An R2 write failure must fail the generate request because no durable preview URL exists.

## 10. POC Completion Criteria

The POC is complete when:

- One deployed Hono Worker serves the two-tab UI and backend APIs.
- Both tabs derive the exact same barcode ID for the same inputs.
- Feature 1 demonstrates a Cache API miss followed by a same-edge hit.
- Feature 2 creates an R2 JPEG and displays its configurable custom-domain URL.
- Repeated custom-domain requests expose evidence of Cloudflare cache behavior, and Smart Tiered Cache is enabled for the R2 hostname.
- The generated barcode and its human-readable ID are visible in both previews.
- Secrets and raw identifiers are absent from public URLs and object keys.

## 11. Known Concerns and Decisions

1. **Cache API and Tiered Cache are separate experiments.** Cache API writes are data-center-local and do not use Tiered Cache. R2 custom-domain delivery is the path used to validate Tiered Cache.
2. **JPEG generation is the main runtime dependency risk.** Cloudflare Workers do not provide a browser DOM or Canvas. Select and smoke-test a pure JavaScript or WebAssembly encoder that is compatible with the Workers runtime. SVG generation is substantially simpler.
3. **QR Code replaces Code 128.** A 64-character Code 128 barcode was too wide for a reliable responsive preview. QR Code keeps the encoded HMAC compact and uses medium error correction.
4. **Cached R2 content relaxes immediate consistency.** Immutable content-address-like object names avoid update and purge complexity. Changing image rendering while retaining the same HMAC ID would require a version in the object path or an explicit purge.
5. **Cache observations depend on deployment and location.** Local development cannot prove edge or tiered caching, and requests from different Cloudflare data centers may legitimately show different lower-tier cache results.

## 12. References

- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [How the Workers cache works](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)
- [Cloudflare Cache with R2](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [R2 public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
