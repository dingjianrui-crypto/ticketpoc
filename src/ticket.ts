import type { TicketIdentity, TicketInput } from "./types";

const encoder = new TextEncoder();
const MAX_INPUT_BYTES = 128;
const BARCODE_ID_PATTERN = /^[a-f0-9]{64}$/;

export class InputError extends Error {}

function normalizeField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new InputError(`${label} must be a string.`);
  }

  const normalized = value.trim();
  const length = encoder.encode(normalized).byteLength;
  if (length === 0) throw new InputError(`${label} is required.`);
  if (length > MAX_INPUT_BYTES) {
    throw new InputError(`${label} must be at most ${MAX_INPUT_BYTES} UTF-8 bytes.`);
  }
  return normalized;
}

export function validateTicketInput(value: unknown): TicketInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError("Request body must be a JSON object.");
  }

  const input = value as Record<string, unknown>;
  return {
    userId: normalizeField(input.userId, "User ID"),
    ticketId: normalizeField(input.ticketId, "Ticket ID"),
  };
}

export function isBarcodeId(value: string): boolean {
  return BARCODE_ID_PATTERN.test(value);
}

export async function createTicketIdentity(
  input: TicketInput,
  secret: string,
): Promise<TicketIdentity> {
  if (!secret) throw new Error("TICKET_HMAC_SECRET is not configured.");

  const userBytes = encoder.encode(input.userId).byteLength;
  const ticketBytes = encoder.encode(input.ticketId).byteLength;
  const message = `${userBytes}:${input.userId}${ticketBytes}:${input.ticketId}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const barcodeId = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return { ...input, barcodeId };
}

export function normalizePrefix(prefix?: string): string {
  return (prefix || "tickets").trim().replace(/^\/+|\/+$/g, "") || "tickets";
}

export function objectKey(prefix: string | undefined, barcodeId: string): string {
  return `${normalizePrefix(prefix)}/v2/${barcodeId}.jpg`;
}

export function publicObjectUrl(baseUrl: string, key: string): string {
  if (!baseUrl) throw new Error("R2_PUBLIC_BASE_URL is not configured.");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") {
    throw new Error("R2_PUBLIC_BASE_URL must use HTTPS.");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/${key}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
