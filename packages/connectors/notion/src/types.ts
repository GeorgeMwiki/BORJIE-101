/**
 * @borjie/connector-notion — domain types.
 *
 * Companion to `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §4.
 *
 * Every shape is immutable. No I/O happens here — types only.
 */

export const PROVIDER = 'notion' as const;
export type Provider = typeof PROVIDER;

/** Canonical block kinds after collapsing the Notion zoo. See spec §4.4. */
export type NotionBlockKind =
  | 'text'
  | 'heading'
  | 'list'
  | 'quote'
  | 'code'
  | 'image'
  | 'file'
  | 'embed'
  | 'structural'
  | 'comment';

/** One canonical row in `notion_pages`. */
export interface NotionPage {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly pageId: string;
  readonly parentId: string | null;
  readonly title: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly lastEditedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

/** One canonical row in `notion_blocks`. */
export interface NotionBlock {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly blockId: string;
  readonly parentId: string | null;
  readonly kind: NotionBlockKind;
  readonly content: Readonly<Record<string, unknown>>;
  readonly lastEditedAt: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

/** Upstream Notion page / block JSON shape — partial; only fields we read. */
export interface NotionUpstreamPage {
  readonly object: 'page';
  readonly id: string;
  readonly last_edited_time: string;
  readonly parent?:
    | { readonly type: 'workspace'; readonly workspace: true }
    | { readonly type: 'page_id'; readonly page_id: string }
    | { readonly type: 'database_id'; readonly database_id: string }
    | { readonly type: 'block_id'; readonly block_id: string };
  readonly properties?: Readonly<Record<string, NotionUpstreamProperty>>;
}

export interface NotionUpstreamProperty {
  readonly type: string;
  readonly title?: ReadonlyArray<{ readonly plain_text?: string }>;
  readonly rich_text?: ReadonlyArray<{ readonly plain_text?: string }>;
  readonly email?: string | null;
  readonly phone_number?: string | null;
  readonly select?: { readonly name?: string } | null;
}

export interface NotionUpstreamBlock {
  readonly object: 'block';
  readonly id: string;
  readonly type: string;
  readonly last_edited_time: string;
  readonly has_children?: boolean;
  readonly parent?:
    | { readonly type: 'page_id'; readonly page_id: string }
    | { readonly type: 'block_id'; readonly block_id: string }
    | { readonly type: 'workspace'; readonly workspace: true };
  readonly [k: string]: unknown;
}

/** Search response. */
export interface NotionSearchResponse {
  readonly results: ReadonlyArray<NotionUpstreamPage>;
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

/** Block-children response. */
export interface NotionBlocksResponse {
  readonly results: ReadonlyArray<NotionUpstreamBlock>;
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

export type Fetcher = (req: Request) => Promise<Response>;

export interface EncryptedCredentialStore {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}

export interface ConnectorLogger {
  readonly info: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
  readonly debug: (message: string, meta?: Readonly<Record<string, unknown>>) => void;
}
