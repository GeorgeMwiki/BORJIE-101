/**
 * YouTube videos repository — in-memory port.
 *
 * Idempotent on (tenant_id, channel_id, video_id). Mirrors migration
 * 0047 UNIQUE constraint on `youtube_videos`.
 */

import type { YouTubeVideo } from '../types.js';

export interface YouTubeVideosRepository {
  readonly upsert: (video: YouTubeVideo) => Promise<{
    readonly inserted: boolean;
  }>;
  readonly listByChannel: (
    tenantId: string,
    channelId: string,
  ) => Promise<ReadonlyArray<YouTubeVideo>>;
}

export function createInMemoryYouTubeVideosRepository(): YouTubeVideosRepository {
  const rows = new Map<string, YouTubeVideo>();
  const key = (v: {
    tenantId: string;
    channelId: string;
    videoId: string;
  }): string => `${v.tenantId}::${v.channelId}::${v.videoId}`;

  return Object.freeze({
    async upsert(video: YouTubeVideo): Promise<{ inserted: boolean }> {
      const k = key(video);
      if (rows.has(k)) {
        return Object.freeze({ inserted: false });
      }
      rows.set(k, video);
      return Object.freeze({ inserted: true });
    },

    async listByChannel(
      tenantId: string,
      channelId: string,
    ): Promise<ReadonlyArray<YouTubeVideo>> {
      const out: YouTubeVideo[] = [];
      for (const row of rows.values()) {
        if (row.tenantId !== tenantId) continue;
        if (row.channelId !== channelId) continue;
        out.push(row);
      }
      out.sort((a, b) =>
        (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''),
      );
      return Object.freeze(out);
    },
  });
}
