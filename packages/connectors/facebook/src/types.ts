/**
 * Facebook connector — shared types.
 *
 * Wave OMNI-P2 #2. Reference:
 * https://developers.facebook.com/docs/graph-api/reference/page/,
 * accessed 2026-05-25.
 */

export type FacebookKind =
  | 'status'
  | 'photo'
  | 'video'
  | 'link'
  | 'event'
  | 'note';

export interface FacebookPost {
  readonly tenantId: string;
  readonly account: string;
  readonly postId: string;
  readonly kind: FacebookKind;
  readonly caption: string | null;
  readonly mediaUrls: ReadonlyArray<string>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly postedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface FacebookInstall {
  readonly tenantId: string;
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
  readonly debug: (msg: string, meta?: Record<string, unknown>) => void;
  readonly info: (msg: string, meta?: Record<string, unknown>) => void;
  readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
  readonly error: (msg: string, meta?: Record<string, unknown>) => void;
}
