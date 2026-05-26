/**
 * TikTok connector — shared types.
 *
 * Wave OMNI-P2 #3. Reference:
 * https://business-api.tiktok.com/portal/docs?id=1738455508553729,
 * accessed 2026-05-25.
 */

export type TikTokKind = 'video' | 'photo' | 'live_replay';

export interface TikTokPost {
  readonly tenantId: string;
  readonly account: string;
  readonly postId: string;
  readonly kind: TikTokKind;
  readonly caption: string | null;
  readonly mediaUrls: ReadonlyArray<string>;
  readonly metrics: Readonly<Record<string, number>>;
  readonly postedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface TikTokInstall {
  readonly tenantId: string;
  readonly account: string;
  readonly clientKey: string;
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
