/**
 * Shared test helpers — Wave 28 Learning-Loop.
 */

import type { ClassifyLLMPort } from '../../ai-native/shared.js';
import {
  createSemanticMemory,
  createInMemorySemanticMemoryRepo,
  createHashEmbedder,
  type SemanticMemory,
} from '../../memory/semantic-memory.js';
import type {
  LearningLoopEventBus,
  OutcomeEvent,
} from '../types.js';

/** Minimal event bus — synchronous dispatch, stored handlers per type. */
export function createFakeEventBus(): LearningLoopEventBus & {
  readonly publish: (
    type: string,
    envelope: {
      readonly event: {
        readonly eventType: string;
        readonly eventId: string;
        readonly tenantId: string;
        readonly timestamp: string;
      } & Record<string, unknown>;
    },
  ) => Promise<void>;
} {
  const handlers = new Map<
    string,
    Array<(e: { event: Record<string, unknown> & { eventType: string; eventId: string; tenantId: string; timestamp: string } }) => Promise<void>>
  >();
  return {
    subscribe(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const current = handlers.get(type);
        if (!current) return;
        handlers.set(
          type,
          current.filter((h) => h !== handler),
        );
      };
    },
    async publish(type, envelope) {
      const list = handlers.get(type) ?? [];
      for (const h of list) {
        await h(envelope);
      }
    },
  };
}

/** Returns a fixed LLM stub that echoes a preset JSON payload. */
export function createMockLlm(raw: string): ClassifyLLMPort {
  return {
    async classify() {
      return {
        raw,
        modelVersion: 'mock-1',
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
}

export function createMemory(): SemanticMemory {
  return createSemanticMemory({
    repo: createInMemorySemanticMemoryRepo(),
    embedder: createHashEmbedder(),
  });
}

/** Build a canonical OutcomeEvent for pattern tests. */
export function buildOutcome(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    actionId: overrides.actionId ?? `act_${Math.random().toString(36).slice(2, 10)}`,
    tenantId: 't1',
    domain: 'finance',
    actionType: 'auto_approve_refund',
    context: overrides.context ?? { amountBand: '50k-60k' },
    decision: 'executed',
    rationale: 'policy-authorized',
    confidence: 0.7,
    executedAt: overrides.executedAt ?? new Date().toISOString(),
    outcome: overrides.outcome ?? 'success',
    ...overrides,
  };
}
