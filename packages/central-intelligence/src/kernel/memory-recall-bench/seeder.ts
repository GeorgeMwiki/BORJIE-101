/**
 * Memory Recall Bench — seeder.
 *
 * Walks a corpus of `RecallSample` rows and writes each into the
 * appropriate `MemoryHierarchy` port BEFORE the bench runs. Pure: no
 * I/O, no network. Adapters bind in-memory fakes; production seeders
 * use Drizzle services.
 *
 * The seeder is intentionally permissive — it skips silently when a
 * tier's port is not bound. Each sample's seeded row is identified by
 * its `sample.id` whenever the port API admits it (in-memory fakes
 * MUST honour this so exact-match scoring is meaningful).
 */

import type { MemoryHierarchy } from '../memory/types.js';
import type { RecallSample } from './types.js';

export async function seedRecallCorpus(
  memory: MemoryHierarchy,
  samples: ReadonlyArray<RecallSample>,
): Promise<void> {
  for (const sample of samples) {
    switch (sample.tier) {
      case 'episodic':
        if (!memory.episodic || !sample.userId) break;
        await memory.episodic.record({
          tenantId: sample.tenantId,
          userId: sample.userId,
          threadId:
            typeof sample.fact.threadId === 'string'
              ? sample.fact.threadId
              : sample.id,
          turnId:
            typeof sample.fact.turnId === 'string'
              ? sample.fact.turnId
              : `${sample.id}-turn`,
          kind:
            (sample.fact.kind as 'user-message' | 'agent-action' | 'tool-result') ??
            'user-message',
          summary:
            typeof sample.fact.summary === 'string'
              ? sample.fact.summary
              : sample.expectedAnswer,
          ...(typeof sample.fact.payload === 'object' && sample.fact.payload !== null
            ? { payload: sample.fact.payload as Record<string, unknown> }
            : {}),
        });
        break;
      case 'semantic':
        if (!memory.semantic) break;
        await memory.semantic.upsertFact({
          tenantId: sample.tenantId,
          userId: sample.userId ?? null,
          key:
            typeof sample.fact.key === 'string' ? sample.fact.key : sample.id,
          value: sample.fact.value ?? sample.expectedAnswer,
          confidence:
            typeof sample.fact.confidence === 'number'
              ? sample.fact.confidence
              : 0.9,
          source:
            (sample.fact.source as 'extracted' | 'declared' | 'consolidated') ??
            'extracted',
        });
        break;
      case 'procedural':
        if (!memory.procedural || !sample.userId) break;
        await memory.procedural.record({
          tenantId: sample.tenantId,
          userId: sample.userId,
          patternName:
            typeof sample.fact.patternName === 'string'
              ? sample.fact.patternName
              : sample.id,
          toolSequence: Array.isArray(sample.fact.toolSequence)
            ? (sample.fact.toolSequence as ReadonlyArray<string>)
            : [],
          triggerKeywords: Array.isArray(sample.fact.triggerKeywords)
            ? (sample.fact.triggerKeywords as ReadonlyArray<string>)
            : [],
          success: true,
        });
        break;
      case 'reflective':
        if (!memory.reflective) break;
        await memory.reflective.record({
          tenantId: sample.tenantId,
          userId: sample.userId ?? null,
          periodKind:
            (sample.fact.periodKind as 'daily' | 'weekly' | 'monthly') ??
            'daily',
          periodStart:
            typeof sample.fact.periodStart === 'string'
              ? sample.fact.periodStart
              : '2026-05-17T00:00:00Z',
          periodEnd:
            typeof sample.fact.periodEnd === 'string'
              ? sample.fact.periodEnd
              : '2026-05-18T00:00:00Z',
          summary:
            typeof sample.fact.summary === 'string'
              ? sample.fact.summary
              : sample.expectedAnswer,
        });
        break;
    }
  }
}
