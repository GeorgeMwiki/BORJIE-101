/**
 * Instagram connector — shared types.
 *
 * Wave OMNI-P2. See Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.1.
 *
 * No I/O, no global state — only types. The connector implements the
 * `SocialConnector` shape from the spec; the package exports each
 * surface as a pure function so the composition root composes them.
 *
 * Reference: Instagram Graph API,
 * https://developers.facebook.com/docs/instagram-api/, accessed
 * 2026-05-25.
 */

export type InstagramKind =
  | 'image'
  | 'video'
  | 'carousel_album'
  | 'reels'
  | 'story';

export interface InstagramPost {
  readonly tenantId: string;
  readonly account: string;
  readonly postId: string;
  readonly kind: InstagramKind;
  readonly caption: string | null;
  readonly mediaUrls: ReadonlyArray<string>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly postedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface InstagramInstall {
  readonly tenantId: string;
  /** Instagram Business account id. */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface SaltProvider {
  readonly forTenant: (tenantId: string) => Promise<string>;
}

export interface FetcherPort {
  readonly fetch: (
    url: string,
    init: {
      readonly method: 'GET' | 'POST';
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ) => Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly text: () => Promise<string>;
  }>;
}

export interface ClockPort {
  readonly nowIso: () => string;
}

export interface UuidPort {
  readonly next: () => string;
}

export interface Logger {
  readonly debug: (msg: string, meta?: Record<string, unknown>) => void;
  readonly info: (msg: string, meta?: Record<string, unknown>) => void;
  readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
  readonly error: (msg: string, meta?: Record<string, unknown>) => void;
}
