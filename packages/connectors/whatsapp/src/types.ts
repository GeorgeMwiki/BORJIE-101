/**
 * @borjie/connector-whatsapp — domain types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §3.
 *
 * Every shape is immutable. No I/O happens here — types only.
 */

/** Provider id — used in logging and in connector_credentials.provider. */
export const PROVIDER = 'whatsapp' as const;
export type Provider = typeof PROVIDER;

/** Direction of the message in the ledger. */
export type WhatsappDirection = 'inbound' | 'outbound';

/**
 * Allowed message kinds. Mirrors the CHECK constraint in migration 0043.
 */
export type WhatsappMessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'reaction'
  | 'unknown';

/** Normalised media projection — internal asset id, never the short-lived Meta URL. */
export interface WhatsappMediaProjection {
  readonly assetId: string;
  readonly mimeType: string;
  readonly sha256?: string;
  readonly filename?: string;
  readonly caption?: string;
}

/** Normalised vCard contact projection — hashed phone / email values. */
export interface WhatsappContactProjection {
  readonly nameHashed: string;
  readonly phonesHashed: ReadonlyArray<string>;
  readonly emailsHashed: ReadonlyArray<string>;
}

/**
 * One persisted row in `whatsapp_messages`. Mirror of the Drizzle type.
 */
export interface WhatsappMessage {
  readonly id: string;
  readonly tenantId: string;
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly waMessageId: string;
  readonly fromPhone: string;
  readonly toPhone: string;
  readonly direction: WhatsappDirection;
  readonly kind: WhatsappMessageKind;
  readonly text: string | null;
  readonly media: WhatsappMediaProjection | null;
  readonly contacts: ReadonlyArray<WhatsappContactProjection> | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

/**
 * Meta-format webhook envelope. Validated by the receiver before
 * normalisation; we type only the fields we actually consume.
 */
export interface WhatsappWebhookEnvelope {
  readonly object: string;
  readonly entry: ReadonlyArray<WhatsappWebhookEntry>;
}

export interface WhatsappWebhookEntry {
  readonly id: string; // waba_id
  readonly changes: ReadonlyArray<WhatsappWebhookChange>;
}

export interface WhatsappWebhookChange {
  readonly field: string;
  readonly value: WhatsappWebhookValue;
}

export interface WhatsappWebhookValue {
  readonly messaging_product: string;
  readonly metadata: {
    readonly display_phone_number: string;
    readonly phone_number_id: string;
  };
  readonly messages?: ReadonlyArray<WhatsappInboundMessage>;
  readonly statuses?: ReadonlyArray<unknown>;
}

export interface WhatsappInboundMessage {
  readonly id: string;
  readonly from: string;
  readonly timestamp: string;
  readonly type: WhatsappMessageKind;
  readonly text?: { readonly body: string };
  readonly image?: { readonly id: string; readonly mime_type: string; readonly sha256?: string; readonly caption?: string };
  readonly video?: { readonly id: string; readonly mime_type: string; readonly sha256?: string; readonly caption?: string };
  readonly audio?: { readonly id: string; readonly mime_type: string; readonly sha256?: string };
  readonly document?: { readonly id: string; readonly mime_type: string; readonly sha256?: string; readonly filename?: string; readonly caption?: string };
  readonly sticker?: { readonly id: string; readonly mime_type: string; readonly sha256?: string };
  readonly contacts?: ReadonlyArray<{ readonly name?: { readonly formatted_name?: string }; readonly phones?: ReadonlyArray<{ readonly phone?: string }>; readonly emails?: ReadonlyArray<{ readonly email?: string }> }>;
}

/**
 * Injected HTTP fetcher port — every upstream HTTP call goes through
 * this so tests never touch the network. Production wires
 * `globalThis.fetch`.
 */
export type Fetcher = (req: Request) => Promise<Response>;

/**
 * Encrypted-at-rest credentials store port — the column type in
 * Postgres is `bytea`. Production wires this to the AES-GCM seal
 * routine; tests pass a passthrough.
 */
export interface EncryptedCredentialStore {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}

/** Logger port — minimal pino-like shape. */
export interface ConnectorLogger {
  readonly info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}
