/**
 * X (formerly Twitter) connector — shared types.
 *
 * Wave OMNI-P2 #4. Reference:
 * https://developer.x.com/en/docs/x-api, X API v2, accessed 2026-05-25.
 *
 * The migration's `x_posts` table uses `text` (not `caption`) for the
 * tweet body — this connector mirrors that.
 */

export type XKind = 'tweet' | 'reply' | 'retweet' | 'quote';

export interface XPost {
  readonly tenantId: string;
  readonly account: string;
  readonly postId: string;
  readonly kind: XKind;
  readonly text: string | null;
  readonly mediaUrls: ReadonlyArray<string>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly postedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface XInstall {
  readonly tenantId: string;
  /** Authenticated user's id (numeric string). */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
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

export interface Logger {
  readonly debug: (m: string, meta?: Record<string, unknown>) => void;
  readonly info: (m: string, meta?: Record<string, unknown>) => void;
  readonly warn: (m: string, meta?: Record<string, unknown>) => void;
  readonly error: (m: string, meta?: Record<string, unknown>) => void;
}
