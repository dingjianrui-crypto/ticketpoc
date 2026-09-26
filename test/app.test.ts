import { env, fetchMock, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createTicketIdentity } from "../src/ticket";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TICKET_BUCKET: R2Bucket;
    TICKET_HMAC_SECRET: string;
    R2_PUBLIC_BASE_URL: string;
    R2_OBJECT_PREFIX: string;
  }
}

const body = { userId: " user-123 ", ticketId: "ticket-456" };

beforeEach(async () => {
  for (const object of (await env.TICKET_BUCKET.list()).objects) {
    await env.TICKET_BUCKET.delete(object.key);
  }
});

describe("ticket APIs", () => {
  it("uses a deterministic, unambiguous HMAC", async () => {
    const one = await createTicketIdentity({ userId: "ab", ticketId: "c" }, "secret");
    const two = await createTicketIdentity({ userId: "a", ticketId: "bc" }, "secret");
    expect(one.barcodeId).toMatch(/^[a-f0-9]{64}$/);
    expect(one.barcodeId).not.toBe(two.barcodeId);
  });

  it("creates a stable SVG URL and caches the image", async () => {
    const creation = await SELF.fetch("https://app.example/api/svg-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(creation.status).toBe(200);
    expect(creation.headers.get("Cache-Control")).toBe("no-store");
    const result = await creation.json<{ barcodeId: string; imageUrl: string }>();
    expect(new URL(result.imageUrl).pathname).toBe(`/tickets/edge/v2/${result.barcodeId}`);
    const first = await SELF.fetch(result.imageUrl);
    expect(first.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(first.headers.get("X-POC-Cache-Status")).toBe("MISS");
    expect(first.headers.get("X-POC-Cache-Age")).toBe("0");
    expect(first.headers.get("Cache-Control")).toContain("s-maxage=14400");
    expect(first.headers.get("ETag")).toContain("qr-svg-v2");
    const svg = await first.text();
    expect(svg).toContain("Ticket QR code");
    expect(svg).toContain("<path");
    const second = await SELF.fetch(result.imageUrl);
    expect(second.headers.get("X-POC-Cache-Status")).toBe("HIT");
    expect(Number(second.headers.get("X-POC-Cache-Age"))).toBeGreaterThanOrEqual(0);
    expect(second.headers.get("ETag")).toBe(first.headers.get("ETag"));
  });

  it("keeps different barcode IDs in independent Cache API entries", async () => {
    const create = async (ticketId: string) => {
      const response = await SELF.fetch("https://app.example/api/svg-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "cache-isolation-user", ticketId }),
      });
      return response.json<{ barcodeId: string; imageUrl: string }>();
    };
    const firstTicket = await create("unique-ticket-a");
    const secondTicket = await create("unique-ticket-b");
    expect(firstTicket.barcodeId).not.toBe(secondTicket.barcodeId);
    expect((await SELF.fetch(firstTicket.imageUrl)).headers.get("X-POC-Cache-Status")).toBe("MISS");
    expect((await SELF.fetch(firstTicket.imageUrl)).headers.get("X-POC-Cache-Status")).toBe("HIT");
    expect((await SELF.fetch(secondTicket.imageUrl)).headers.get("X-POC-Cache-Status")).toBe("MISS");
  });

  it("creates an R2 JPEG with cacheable HTTP metadata and reuses it", async () => {
    const request = () => SELF.fetch("https://app.example/api/r2-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const first = await request();
    const result = await first.json<{ barcodeId: string; imageUrl: string; objectKey: string; created: boolean }>();
    expect(first.status).toBe(201);
    expect(result.created).toBe(true);
    expect(result.objectKey).toContain("/v2/");
    expect(result.imageUrl).toBe(`${env.R2_PUBLIC_BASE_URL}/${result.objectKey}`);
    const object = await env.TICKET_BUCKET.get(result.objectKey);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(object?.httpMetadata?.cacheControl).toContain("s-maxage=14400");
    expect(object?.customMetadata?.barcodeFormat).toBe("qr");
    expect(new Uint8Array(await object!.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
    const second = await request();
    expect(second.status).toBe(200);
    expect((await second.json<{ created: boolean }>()).created).toBe(false);
  });

  it("switches an existing R2 JPEG between shared-cache and no-store metadata", async () => {
    const request = (cacheBehavior: "default" | "no-store") => SELF.fetch("https://app.example/api/r2-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, cacheBehavior }),
    });

    const noStoreResponse = await request("no-store");
    const noStore = await noStoreResponse.json<{ objectKey: string; cacheControl: string; metadataUpdated: boolean }>();
    expect(noStore.cacheControl).toBe("no-store");
    expect((await env.TICKET_BUCKET.head(noStore.objectKey))?.httpMetadata?.cacheControl).toBe("no-store");

    const defaultResponse = await request("default");
    const restored = await defaultResponse.json<{ cacheControl: string; metadataUpdated: boolean }>();
    expect(restored.metadataUpdated).toBe(true);
    expect(restored.cacheControl).toContain("s-maxage=14400");
    expect((await env.TICKET_BUCKET.head(noStore.objectKey))?.httpMetadata?.cacheControl).toContain("s-maxage=14400");
  });

  it("rejects unsupported R2 cache behavior values", async () => {
    const response = await SELF.fetch("https://app.example/api/r2-tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, cacheBehavior: "invalid" }),
    });
    expect(response.status).toBe(400);
  });

  it("previews locally simulated R2 objects through a local-only route", async () => {
    const response = await SELF.fetch("http://localhost/api/r2-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await response.json<{ imageUrl: string; previewUrl: string }>();
    expect(result.imageUrl).toContain(new URL(env.R2_PUBLIC_BASE_URL).hostname);
    expect(result.previewUrl).toContain("localhost/local/r2-preview/");
    const preview = await SELF.fetch(result.previewUrl);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await preview.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
  });

  it("reports R2 custom-domain cache headers and their meaning", async () => {
    const creation = await SELF.fetch("https://app.example/api/r2-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const ticket = await creation.json<{ barcodeId: string; objectKey: string }>();
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get(env.R2_PUBLIC_BASE_URL).intercept({ path: `/${ticket.objectKey}`, method: "GET" }).reply(200, "jpeg", {
      headers: {
        "CF-Cache-Status": "HIT", Age: "42", "Cache-Control": "public, s-maxage=14400",
        ETag: '"qr"', "Content-Type": "image/jpeg", "CF-Ray": "abc-SJC",
      },
    });
    const diagnostic = await SELF.fetch(`https://app.example/api/r2-cache-diagnostics/${ticket.barcodeId}.jpg`);
    const result = await diagnostic.json<{ source: string; headers: { cfCacheStatus: string; age: string } }>();
    expect(result.source).toBe("Cloudflare cache");
    expect(result.headers.cfCacheStatus).toBe("HIT");
    expect(result.headers.age).toBe("42");
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  it("rejects invalid inputs and barcode URLs", async () => {
    const invalid = await SELF.fetch("https://app.example/api/svg-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "", ticketId: "x" }),
    });
    expect(invalid.status).toBe(400);
    expect((await SELF.fetch("https://app.example/tickets/edge/v2/no")).status).toBe(400);
  });
});
