/**
 * LinkedIn connector — shared types.
 *
 * Wave OMNI-P2 #5. Reference: Microsoft Learn,
 * https://learn.microsoft.com/en-us/linkedin/marketing/, *LinkedIn
 * Marketing API*, accessed 2026-05-25.
 *
 * P2 ships read-only — `w_member_social` is *not* requested.
 */

export type LinkedInKind =
  | 'share'
  | 'article'
  | 'video'
  | 'image'
  | 'event'
  | 'document';

export interface LinkedInPost {
  readonly tenantId: string;
  readonly account: string;
  readonly postId: string;
  readonly kind: LinkedInKind;
  readonly caption: string | null;
  readonly mediaUrls: ReadonlyArray<string>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly postedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface LinkedInInstall {
  readonly tenantId: string;
  /** LinkedIn organization URN, e.g. `urn:li:organization:1234567`. */
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
