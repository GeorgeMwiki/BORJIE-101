/**
 * Topic-file store — topic-scoped memory shards.
 *
 * A topic file collects facts + episode references for a single topic
 * key (e.g. "borrower:abc-123" or "property:123 Main St"). Useful for
 * fast subject-scoped recall without scanning the whole episodic store.
 */

import type { TenantId, TopicFile, TopicFileStore } from '../types.js';

export function createInMemoryTopicFileStore(): TopicFileStore {
  const files = new Map<string, TopicFile>();

  return {
    async upsertTopic(file: TopicFile): Promise<TopicFile> {
      files.set(`${file.tenantId}:${file.topic}`, file);
      return file;
    },

    async getByTopic(
      tenantId: TenantId,
      topic: string,
    ): Promise<TopicFile | null> {
      return files.get(`${tenantId}:${topic}`) ?? null;
    },
  };
}
