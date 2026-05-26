/**
 * YouTube connector — shared types.
 *
 * Wave OMNI-P2 #6. Reference: Google Developers,
 * https://developers.google.com/youtube/v3, *YouTube Data API (v3)*,
 * accessed 2026-05-25.
 *
 * Migration shape: `youtube_videos` row = (channel_id, video_id, title,
 * description, duration_s, view_count, like_count, comment_count,
 * published_at, raw).
 */

export interface YouTubeVideo {
  readonly tenantId: string;
  readonly channelId: string;
  readonly videoId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly durationS: number | null;
  readonly viewCount: number | null;
  readonly likeCount: number | null;
  readonly commentCount: number | null;
  readonly publishedAt: string | null;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface YouTubeInstall {
  readonly tenantId: string;
  readonly channelId: string;
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
