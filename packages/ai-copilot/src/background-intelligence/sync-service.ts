/**
 * Background insight sync.
 *
 * When a foreground session opens for a user, this service flushes any
 * unacknowledged insights for their tenant into the session. The service
 * itself doesn't decide *how* to deliver \u2014 it just assembles the payload;
 * chat-ui (Agent C) picks which become toasts vs bubbles.
 */

import type { BackgroundInsight, InsightStore } from './types.js';

export interface IntelligenceSyncPayload {
  readonly tenantId: string;
  readonly userId: string;
  readonly openedAt: string;
  readonly insights: readonly BackgroundInsight[];
  readonly critical: readonly BackgroundInsight[];
}

export class IntelligenceSyncService {
  constructor(private readonly store: InsightStore) {}

  async onSessionOpen(
    tenantId: string,
    userId: string,
    opts: { limit?: number } = {},
  ): Promise<IntelligenceSyncPayload> {
    const insights = await this.store.listUnacknowledged(
      tenantId,
      opts.limit ?? 50,
    );
    const critical = insights.filter(
      (i) => i.severity === 'high' || i.severity === 'critical',
    );
    return {
      tenantId,
      userId,
      openedAt: new Date().toISOString(),
      insights,
      critical,
    };
  }

  async acknowledge(
    tenantId: string,
    userId: string,
    insightId: string,
  ): Promise<void> {
    await this.store.acknowledge(insightId, tenantId, userId);
  }
}
