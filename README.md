# Cloudflare Ticket Cache POC

This Hono application demonstrates two Cloudflare image-delivery paths:

1. **Edge SVG** — generate a QR Code ticket SVG on demand and store it with the Workers Cache API.
2. **R2 JPEG** — generate a QR Code JPEG, store it in R2, and serve it through an R2 custom domain with Cloudflare Cache and Smart Tiered Cache.

The same User ID and Ticket ID produce the same HMAC-SHA-256 barcode ID in both flows. See [REQUIREMENTS.md](./REQUIREMENTS.md) for detailed behavior and scope.

## Project structure

```text
src/index.ts       Hono routes, Cache API logic, and R2 writes
src/ticket.ts      Input validation and HMAC generation
src/barcode.ts     QR Code SVG and JPEG rendering
src/ui.ts          Two-tab browser UI
test/app.test.ts   Worker integration tests
wrangler.jsonc     Worker, variables, and R2 binding
```

## Prerequisites

- Node.js 20 or newer
- npm
- A Cloudflare account for deployment
- An R2 bucket
- A domain managed by Cloudflare for the deployed cache tests

Wrangler is installed as a project dependency, so a separate global installation is unnecessary. Run it with `npx wrangler`.

## Run locally

### 1. Install dependencies

From this project directory:

```bash
npm install
```

### 2. Configure the local secret

Copy the example secret file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and replace the example value with a development-only secret:

```dotenv
TICKET_HMAC_SECRET=replace-with-a-long-random-development-secret
```

Do not commit `.dev.vars`. It is already listed in `.gitignore`. Production secrets are configured separately through Wrangler.

### 3. Review local variables

The default values are in [wrangler.jsonc](./wrangler.jsonc):

```jsonc
"vars": {
  "R2_PUBLIC_BASE_URL": "https://tickets.example.com",
  "R2_OBJECT_PREFIX": "tickets",
  "EDGE_CACHE_TTL_SECONDS": "14400",
  "BROWSER_CACHE_TTL_SECONDS": "0"
}
```

The variables mean:

| Variable | Purpose |
| --- | --- |
| `R2_PUBLIC_BASE_URL` | Public R2 custom-domain base URL used to build JPEG links |
| `R2_OBJECT_PREFIX` | R2 logical folder; no leading or trailing slash is needed |
| `EDGE_CACHE_TTL_SECONDS` | Shared Cloudflare cache lifetime |
| `BROWSER_CACHE_TTL_SECONDS` | Browser cache lifetime; `0` is convenient while testing CDN behavior |

The JPEG module supplies its own small browser-compatible `Buffer` implementation because `jpeg-js` uses that API internally. No Node compatibility flag is required.

For local development, Wrangler creates a local R2 simulation for the configured `TICKET_BUCKET` binding. It does not contact or modify the real bucket unless remote bindings are deliberately enabled.

### 4. Start the application

```bash
npm run dev
```

Open the URL printed by Wrangler, normally:

```text
http://localhost:8787
```

The **Edge SVG** feature works completely in local development. The **R2 JPEG** API writes to locally simulated R2. In local mode, the UI previews that object through a local-only same-origin bridge while still displaying the configured public R2 URL. The public URL will return 404 until the Worker is deployed and writes the object to the real bucket. End-to-end custom-domain and Tiered Cache verification still requires deployment.

### 5. Run local checks

```bash
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

The tests cover deterministic HMAC generation, input validation, SVG cache reuse, JPEG encoding, R2 metadata, and idempotent R2 generation. Local cache tests validate application logic through Cloudflare's Worker simulator; they do not prove real edge placement or Tiered Cache behavior.

## Deploy to Cloudflare

### 1. Log in to Cloudflare

```bash
npx wrangler login
```

Verify the active account:

```bash
npx wrangler whoami
```

### 2. Create or identify the R2 bucket

If a bucket does not already exist, create one:

```bash
npx wrangler r2 bucket create YOUR_BUCKET_NAME
```

If you already have a bucket, use its exact bucket name. The folder does not need to be created in advance; R2 uses object-key prefixes rather than physical folders.

### 3. Configure the Worker binding and variables

Edit [wrangler.jsonc](./wrangler.jsonc):

```jsonc
{
  "vars": {
    "R2_PUBLIC_BASE_URL": "https://tickets-assets.example.com",
    "R2_OBJECT_PREFIX": "tickets",
    "EDGE_CACHE_TTL_SECONDS": "14400",
    "BROWSER_CACHE_TTL_SECONDS": "0"
  },
  "r2_buckets": [
    {
      "binding": "TICKET_BUCKET",
      "bucket_name": "YOUR_BUCKET_NAME"
    }
  ]
}
```

Keep the binding name `TICKET_BUCKET`; the source code accesses that exact binding. Replace only `bucket_name`.

JPEGs will be stored under this key pattern:

```text
<R2_OBJECT_PREFIX>/v2/<barcodeId>.jpg
```

For example:

```text
tickets/v2/32cf6e...a9d1.jpg
```

The `v2` segment identifies the QR Code renderer and protects immutable cached URLs from earlier or future rendering formats.

### 4. Connect a custom domain to R2

In the Cloudflare dashboard:

1. Open **R2 Object Storage**.
2. Select the configured bucket.
3. Open **Settings**.
4. Under **Public access**, connect a **Custom Domain**, such as `tickets-assets.example.com`.
5. Wait until the domain status is active.
6. Set `R2_PUBLIC_BASE_URL` in `wrangler.jsonc` to the exact HTTPS origin, with no object folder appended.

Use the R2 custom domain, not an `r2.dev` address. The custom domain is required for Cloudflare Cache and Smart Tiered Cache.

### 5. Configure R2 caching

Create a Cache Rule for the R2 hostname in the Cloudflare zone. A suitable POC rule is:

```text
When hostname equals tickets-assets.example.com
Then cache eligibility = Eligible for cache
Edge TTL = Respect origin Cache-Control
Cache key query string = Ignore query string
```

The application writes this HTTP metadata to every JPEG object:

```http
Content-Type: image/jpeg
Cache-Control: public, max-age=0, s-maxage=14400, immutable
Content-Disposition: inline; filename="<barcodeId>.jpg"
```

`s-maxage` controls shared-cache freshness. `max-age=0` makes the browser contact Cloudflare again, which makes repeated `CF-Cache-Status` results easier to observe during the POC. You can increase `BROWSER_CACHE_TTL_SECONDS` later.

Then enable **Smart Tiered Cache** under the zone's Cache/Tiered Cache settings. Headers make an object cacheable, but enabling Tiered Cache is a separate zone configuration step.

### 6. Add the production HMAC secret

Run:

```bash
npx wrangler secret put TICKET_HMAC_SECRET
```

Enter a long random value when prompted. Do not add the production secret to `wrangler.jsonc` or `.dev.vars`. Changing this secret changes all generated barcode IDs.

### 7. Deploy the Worker

```bash
npm run deploy
```

Wrangler prints the deployed Worker URL. The application can be opened there for a functional check, but the explicit Cache API experiment must use a Worker custom domain or route. Cache API operations on `workers.dev` do not provide the intended production cache behavior.

### 8. Add a Worker custom domain

In the Cloudflare dashboard:

1. Open **Workers & Pages** and select `ticket-cache-poc`.
2. Open **Settings** and then **Domains & Routes**.
3. Add a custom domain such as `ticket-poc.example.com`.
4. Open `https://ticket-poc.example.com` after the hostname becomes active.

Use separate hostnames for the Worker UI and R2 assets:

```text
ticket-poc.example.com       Hono Worker and Edge SVG route
tickets-assets.example.com  R2 custom domain and JPEG objects
```

Do not route the R2 hostname through this Worker. The JPEG preview must load directly from the R2 custom domain to exercise the R2 CDN path.

## Verify caching after deployment

Generate one ticket from each tab and copy the displayed URLs. Request each URL twice from the same machine. Use `GET` rather than relying only on `HEAD`, so the test follows the same route as the browser image request.

### Workers Cache API SVG

```bash
curl -sS -D - -o /dev/null "https://ticket-poc.example.com/tickets/edge/v2/BARCODE_ID"
curl -sS -D - -o /dev/null "https://ticket-poc.example.com/tickets/edge/v2/BARCODE_ID"
```

Expected application diagnostic:

```text
X-POC-Cache-Status: MISS
X-POC-Cache-Status: HIT
```

The Edge SVG tab displays `X-POC-Cache-Status`, `X-POC-Cache-Age`, `CF-Cache-Status`, standard CDN `Age`, `Cache-Control`, `ETag`, `Content-Type`, `CF-Ray`, the HTTP status, and an interpreted source. Its **Refresh image + headers** button directly fetches the same-origin SVG, reads the headers, and renders that exact response. `X-POC-Cache-Status` is authoritative for this explicit Cache API experiment: `MISS` means the Worker generated the SVG, and `HIT` means `caches.default.match()` returned it. The Worker calculates `X-POC-Cache-Age` from a timestamp stored with the cached response because the Cache API does not reliably add the standard `Age` header. `CF-Cache-Status` and standard `Age` may be absent because this path uses the explicit Worker Cache API rather than ordinary origin caching.

The Cache API is local to a Cloudflare data center. Requests reaching a different data center may legitimately produce another `MISS`; this path does not use Tiered Cache.

### R2 custom-domain JPEG

```bash
curl -sS -D - -o /dev/null "https://tickets-assets.example.com/tickets/v2/BARCODE_ID.jpg"
curl -sS -D - -o /dev/null "https://tickets-assets.example.com/tickets/v2/BARCODE_ID.jpg"
```

Expected Cloudflare headers commonly include:

```text
CF-Cache-Status: MISS
CF-Cache-Status: HIT
Age: <seconds>
```

`Age` normally appears on cached responses, not the initial miss. Tiered Cache does not guarantee that every new geographic location immediately reports a lower-tier `HIT`; its purpose is to let lower tiers consult an upper tier before reaching R2.

The R2 tab automatically calls a same-origin diagnostic endpoint and displays `CF-Cache-Status`, `Age`, `Cache-Control`, `ETag`, `Content-Type`, `CF-Ray`, the HTTP status, and an interpreted source. The first measured request is made before the preview image loads, so a new uncached object should normally report `MISS`. Use **Refresh image + headers** on the preview to make another measured request and observe a transition such as `MISS` to `HIT`. The diagnostic request is separate from the browser image request but targets the exact same immutable R2 URL immediately before reloading the preview.

Interpret `CF-Cache-Status` as follows:

| Value | Meaning |
| --- | --- |
| `HIT` | Served from Cloudflare cache |
| `STALE` / `UPDATING` | Served from cache while stale or refreshing |
| `REVALIDATED` | Cached content was validated and served |
| `MISS` | Not present at that cache tier; Cloudflare fetched from R2 |
| `BYPASS` / `DYNAMIC` | Cache was bypassed or the response was not cache eligible |

`Age` is the number of seconds the response has resided in cache. `CF-Ray` identifies the Cloudflare request and includes the responding data-center code.

## Troubleshooting

### `TICKET_HMAC_SECRET is not configured`

- Local: create `.dev.vars` and set `TICKET_HMAC_SECRET`.
- Production: run `npx wrangler secret put TICKET_HMAC_SECRET`, then deploy again if necessary.

### R2 binding or bucket error

Confirm that `bucket_name` exactly matches an R2 bucket in the Cloudflare account reported by `npx wrangler whoami`. Keep the binding name as `TICKET_BUCKET`.

### `Buffer is not defined` while generating a JPEG

Run `npm install` to ensure the `buffer` runtime dependency is installed, then stop and restart `npm run dev`. The JPEG module imports the browser-compatible implementation directly, so `nodejs_compat` is not required.

### JPEG URL returns 404

- Confirm that `R2_PUBLIC_BASE_URL` is the active custom-domain origin.
- Confirm that its domain is attached to the same bucket used by `TICKET_BUCKET`.
- Confirm that the URL contains the configured prefix and `/v2/`.
- Generate the JPEG again and check Worker logs for an R2 write error.
- If the app is running locally, this is expected for the displayed public URL: the object exists only in Wrangler's local R2 simulator. Use the inline local preview or deploy the Worker.
- If a 404 was previously cached before the object existed, purge that exact URL from Cloudflare Cache or wait for the negative-cache TTL. Configure a Cache Rule with a zero Edge TTL for 404 responses during the POC.

### R2 response always says `CF-Cache-Status: DYNAMIC`

- Confirm that the hostname is proxied by Cloudflare and attached as an R2 custom domain.
- Confirm that the Cache Rule matches the exact hostname and marks it eligible for cache.
- Inspect the response for `Cache-Control`, `Set-Cookie`, and other cache-bypass conditions.
- Request the URL without changing its query string.

### SVG always says `MISS`

- Use the Worker custom domain rather than localhost or `workers.dev`.
- Request the exact same URL without query-string changes.
- Test repeatedly from the same network/location; Cache API entries are data-center-local.

### Browser appears not to contact Cloudflare

Use the browser developer tools with browser caching disabled, or verify with the `curl` commands above. Browser caching can hide requests from Cloudflare.

## API summary

```text
GET  /                              Web UI
GET  /health                        Health check
POST /api/svg-tickets               Derive an Edge SVG URL
GET  /tickets/edge/v2/:barcodeId      Generate/cache an SVG
POST /api/r2-tickets                Generate/store an R2 JPEG
GET  /api/r2-cache-diagnostics/:barcodeId.jpg  Inspect R2 CDN headers
```

Both POST endpoints accept JSON:

```json
{
  "userId": "user-123",
  "ticketId": "ticket-456"
}
```

The POST responses use `Cache-Control: no-store`. Only immutable image URLs are shared-cacheable.
