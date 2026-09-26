export interface Bindings {
  TICKET_BUCKET: R2Bucket;
  TICKET_HMAC_SECRET: string;
  R2_PUBLIC_BASE_URL: string;
  R2_OBJECT_PREFIX?: string;
  EDGE_CACHE_TTL_SECONDS?: string;
  BROWSER_CACHE_TTL_SECONDS?: string;
}

export interface TicketInput {
  userId: string;
  ticketId: string;
}

export interface TicketIdentity extends TicketInput {
  barcodeId: string;
}
