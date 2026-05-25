/**
 * Outcome capture — Wave 28.
 *
 * Subscribes to `action.completed` events on the platform event bus and
 * persists each one as an `OutcomeEvent` in the repository. Caller also
 * gets a programmatic `record(...)` entry point for synchronous call
 * sites that want to bypass the bus (e.g. the autonomy guard).
 *
 * Intentionally dependency-light: no LLM, no reflection. Reflection is
 * a separate module that reads from the same repository.
 */

import type {
  LearningLoopEventBus,
  OutcomeEvent,
  OutcomeRepository,
  OutcomeStatus,
} from './types.js';
import type { AutonomyDomain } from '../autonomy/types.js';
import { logger } from '../logger.js';

export interface OutcomeCaptureDeps {
  readonly eventBus?: LearningLoopEventBus;
  readonly repository: OutcomeRepository;
  readonly now?: () => Date;
  /** Event type to subscribe to. Defaults to `action.completed`. */
  readonly eventType?: string;
}

export interface RecordOutcomeInput {
  readonly actionId: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly actionType: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly decision: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly outcome?: OutcomeStatus;
  readonly feedbackScore?: number;
  readonly observedConsequences?: string;
  readonly executedAt?: string;
}

export interface OutcomeCapture {
  /** Programmatic entry point. */
  record(input: RecordOutcomeInput): Promise<OutcomeEvent>;
  /**
   * Update the outcome of a previously-recorded action (e.g. revert signal
   * arrives later).
   */
  updateOutcome(
    actionId: string,
    patch: Readonly<{
      outcome?: OutcomeStatus;
      feedbackScore?: number;
      observedConsequences?: string;
    }>,
  ): Promise<OutcomeEvent | null>;
  /** Attach the subscriber to the bus; returns an unsubscribe handle. */
  subscribe(): () => void;
}

const DEFAULT_EVENT_TYPE = 'action.completed';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function extractAutonomyDomain(raw: unknown): AutonomyDomain {
  const validDomains: readonly AutonomyDomain[] = [
    'finance',
    'leasing',
    'maintenance',
    'compliance',
    'communications',
    'marketing',
    'hr',
    'procurement',
    'insurance',
    'legal_proceedings',
    'tenant_welfare',
  ];
  if (typeof raw === 'string' && (validDomains as readonly string[]).includes(raw)) {
    return raw as AutonomyDomain;
  }
  return 'finance';
}

export function createOutcomeCapture(deps: OutcomeCaptureDeps): OutcomeCapture {
  const now = deps.now ?? (() => new Date());
  const eventType = deps.eventType ?? DEFAULT_EVENT_TYPE;

  async function record(input: RecordOutcomeInput): Promise<OutcomeEvent> {
    if (!input.actionId || input.actionId.trim() === '') {
      throw new Error('outcome-capture: actionId is required');
    }
    if (!input.tenantId || input.tenantId.trim() === '') {
      throw new Error('outcome-capture: tenantId is required');
    }

    const event: OutcomeEvent = {
      actionId: input.actionId,
      tenantId: input.tenantId,
      domain: input.domain,
      actionType: input.actionType,
      context: input.context ? { ...input.context } : {},
      decision: input.decision,
      rationale: input.rationale,
      confidence: clamp01(input.confidence),
      executedAt: input.executedAt ?? now().toISOString(),
      outcome: input.outcome ?? 'pending',
      ...(input.feedbackScore !== undefined ? { feedbackScore: input.feedbackScore } : {}),
      ...(input.observedConsequences !== undefined
        ? { observedConsequences: input.observedConsequences }
        : {}),
    };

    return deps.repository.insert(event);
  }

  async function updateOutcome(
    actionId: string,
    patch: Readonly<{
      outcome?: OutcomeStatus;
      feedbackScore?: number;
      observedConsequences?: string;
    }>,
  ): Promise<OutcomeEvent | null> {
    return deps.repository.updateStatus(actionId, patch);
  }

  function subscribe(): () => void {
    if (!deps.eventBus) {
      return () => {};
    }
    const unsubscribe = deps.eventBus.subscribe(eventType, async (envelope) => {
      const event = envelope.event;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const actionId =
        typeof payload.actionId === 'string' ? payload.actionId : event.eventId;
      try {
        await record({
          actionId,
          tenantId: event.tenantId,
          domain: extractAutonomyDomain(payload.domain),
          actionType:
            typeof payload.actionType === 'string'
              ? payload.actionType
              : 'unknown',
          context:
            payload.context && typeof payload.context === 'object'
              ? (payload.context as Record<string, unknown>)
              : {},
          decision:
            typeof payload.decision === 'string' ? payload.decision : 'unknown',
          rationale:
            typeof payload.rationale === 'string' ? payload.rationale : '',
          confidence:
            typeof payload.confidence === 'number' ? payload.confidence : 0.5,
          outcome:
            typeof payload.outcome === 'string'
              ? (payload.outcome as OutcomeStatus)
              : 'pending',
          executedAt: event.timestamp,
        });
      } catch (err) {
        // Capture is fire-and-forget from the bus's perspective.
         
        logger.error('outcome-capture: failed to record', { error: err });
      }
    });
    return unsubscribe;
  }

  return { record, updateOutcome, subscribe };
}

// ---------------------------------------------------------------------------
// In-memory repository — test fixtures + local dev.
// ---------------------------------------------------------------------------

export function createInMemoryOutcomeRepository(): OutcomeRepository {
  const rows = new Map<string, OutcomeEvent>();
  return {
    async insert(outcome) {
      rows.set(outcome.actionId, outcome);
      return outcome;
    },
    async updateStatus(actionId, patch) {
      const existing = rows.get(actionId);
      if (!existing) return null;
      const updated: OutcomeEvent = {
        ...existing,
        ...(patch.outcome !== undefined ? { outcome: patch.outcome } : {}),
        ...(patch.feedbackScore !== undefined
          ? { feedbackScore: patch.feedbackScore }
          : {}),
        ...(patch.observedConsequences !== undefined
          ? { observedConsequences: patch.observedConsequences }
          : {}),
      };
      rows.set(actionId, updated);
      return updated;
    },
    async findByTenant(tenantId, filters) {
      let list = Array.from(rows.values()).filter((r) => r.tenantId === tenantId);
      if (filters?.domain) {
        list = list.filter((r) => r.domain === filters.domain);
      }
      if (filters?.actionType) {
        list = list.filter((r) => r.actionType === filters.actionType);
      }
      if (filters?.since) {
        const sinceMs = new Date(filters.since).getTime();
        list = list.filter((r) => new Date(r.executedAt).getTime() >= sinceMs);
      }
      list.sort(
        (a, b) =>
          new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
      );
      const limit = filters?.limit ?? list.length;
      return list.slice(0, limit);
    },
    async findByActionId(actionId) {
      return rows.get(actionId) ?? null;
    },
  };
}
