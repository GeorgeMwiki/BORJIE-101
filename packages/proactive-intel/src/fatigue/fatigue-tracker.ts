/**
 * Fatigue tracker.
 *
 * Tracks per-tenant + per-rec-type acceptance / rejection / ignore
 * counts. Entity-store backed for persistence — but the I/O is gated
 * to two methods (`read`, `record`) so unit tests can fake the store.
 *
 * "Ignored" means: notification delivered, owner never tapped anything
 * within a window. The chat-workspace records that signal back via
 * `record({ outcome: 'ignored' })` after the window elapses.
 */
import type { EntityStore } from '../contracts/entity-store.js';
import type {
  AnomalyKind,
  OpportunityKind,
} from '../contracts/events.js';

export type RecommendationKind = AnomalyKind | OpportunityKind;
export type Outcome = 'approved' | 'declined' | 'ignored';

export interface FatigueHistory {
  readonly tenantId: string | null;
  readonly kind: RecommendationKind;
  readonly approved: number;
  readonly declined: number;
  readonly ignored: number;
  /** Most-recent N outcomes, newest first. Capped at MAX_RECENT. */
  readonly recent: ReadonlyArray<Outcome>;
  readonly lastUpdated: string;
}

const KIND_STORE = 'proactive-intel.fatigue';
const MAX_RECENT = 10;

function emptyHistory(
  tenantId: string | null,
  kind: RecommendationKind,
  nowIso: string,
): FatigueHistory {
  return {
    tenantId,
    kind,
    approved: 0,
    declined: 0,
    ignored: 0,
    recent: [],
    lastUpdated: nowIso,
  };
}

function fatigueId(
  tenantId: string | null,
  kind: RecommendationKind,
): string {
  return `${tenantId ?? 'platform'}:${kind}`;
}

export async function readHistory(
  store: EntityStore,
  scope: 'tenant' | 'platform-internal',
  tenantId: string | null,
  kind: RecommendationKind,
): Promise<FatigueHistory> {
  const id = fatigueId(tenantId, kind);
  const ent = await store.read<typeof KIND_STORE, FatigueHistory>(
    scope,
    tenantId,
    KIND_STORE,
    id,
  );
  if (ent) return ent.data;
  return emptyHistory(tenantId, kind, new Date(0).toISOString());
}

export interface RecordParams {
  readonly scope: 'tenant' | 'platform-internal';
  readonly tenantId: string | null;
  readonly kind: RecommendationKind;
  readonly outcome: Outcome;
  readonly nowMs?: number;
}

export async function recordOutcome(
  store: EntityStore,
  params: RecordParams,
): Promise<FatigueHistory> {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const current = await readHistory(
    store,
    params.scope,
    params.tenantId,
    params.kind,
  );
  const next = applyOutcome(current, params.outcome, nowIso);
  await store.write<typeof KIND_STORE, FatigueHistory>({
    scope: params.scope,
    tenantId: params.tenantId,
    kind: KIND_STORE,
    id: fatigueId(params.tenantId, params.kind),
    data: next,
  });
  return next;
}

function applyOutcome(
  current: FatigueHistory,
  outcome: Outcome,
  nowIso: string,
): FatigueHistory {
  const recent = [outcome, ...current.recent].slice(0, MAX_RECENT);
  return {
    tenantId: current.tenantId,
    kind: current.kind,
    approved:
      current.approved + (outcome === 'approved' ? 1 : 0),
    declined:
      current.declined + (outcome === 'declined' ? 1 : 0),
    ignored: current.ignored + (outcome === 'ignored' ? 1 : 0),
    recent,
    lastUpdated: nowIso,
  };
}
