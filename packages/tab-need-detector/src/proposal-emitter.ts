/**
 * Piece O — Proposal emitter.
 *
 * Converts above-threshold aggregations into `tab_spawn_proposals`
 * rows, but only if:
 *   * the module isn't already installed for the tenant
 *   * the user hasn't declined the same module within `declineSnoozeDays`
 *   * there isn't already a pending proposal for the same (user, module)
 *
 * Pure: input is aggregations + history + config; output is `EmitPlan`
 * with rows to insert. Cron does the IO.
 *
 * Proposal messages use a small i18n-friendly template registry so
 * the UX surface (banner) can render the human-readable text without
 * having to know which signals drove the score.
 */

import type {
  AggregatedScore,
  ModuleTemplateId,
  ProposalRow,
  ProposalStatus,
} from './types.js';

/**
 * Lightweight projection of an existing proposal row — only the columns
 * the emitter needs to decide "should I emit?".
 */
export interface ProposalHistoryEntry {
  readonly userId: string;
  readonly suggestedModuleTemplateId: ModuleTemplateId;
  readonly status: ProposalStatus;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

export interface EmitOptions {
  readonly now: Date;
  readonly scoreThreshold: number;
  readonly declineSnoozeDays: number;
  readonly proposalExpiryDays: number;
  /**
   * Installed module template ids for the tenant. Aggregations for
   * these modules are skipped. Cron resolves this set; emitter is pure.
   */
  readonly installedModuleTemplateIds: ReadonlySet<ModuleTemplateId>;
  /**
   * Existing proposal history for the tenant, scoped to "rows we'd
   * possibly clash with". Cron fetches this; emitter consults.
   */
  readonly history: ReadonlyArray<ProposalHistoryEntry>;
  /**
   * Id generator. Defaults to crypto.randomUUID() in cron; injected
   * here so tests are deterministic.
   */
  readonly generateId: () => string;
}

export interface EmitPlanEntry {
  readonly row: ProposalRow;
  /** Why the emitter chose to emit, for telemetry. */
  readonly reason: string;
}

export interface SkippedEntry {
  readonly aggregation: AggregatedScore;
  readonly reason: string;
}

export interface EmitPlan {
  readonly emit: readonly EmitPlanEntry[];
  readonly skipped: readonly SkippedEntry[];
}

// ─────────────────────────────────────────────────────────────────────────
// Proposal message templates. Keys are module ids.
// ─────────────────────────────────────────────────────────────────────────

const PROPOSAL_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  COMPLIANCE:
    'I noticed several compliance-related signals this week. Want to add a Compliance tab to your dashboard?',
  LEGAL:
    'A pattern of legal-related activity suggests a Legal tab would help. Want me to add it?',
  HR:
    'Your conversations mention HR topics frequently. Want to add an HR tab to streamline payroll, leave, and onboarding?',
  PROCUREMENT:
    'I see purchase orders and vendor invoices in your uploads. Want to add a Procurement tab?',
  FLEET:
    'Fleet-related queries are recurring. Want to add a Fleet tab for vehicles and drivers?',
  STRATEGY:
    'You revisit finance views but rarely act on them. Want a Strategy tab with higher-level summaries?',
});

const FALLBACK_MESSAGE_PREFIX =
  'Based on recent activity, I can add a new tab for: ';

/**
 * Lookup a registered proposal message. Uses Map.get over bracket
 * indexing so security/detect-object-injection is satisfied —
 * `moduleId` is a TEXT column whose value originates from a tenant-
 * supplied catalogue + must therefore be treated as untrusted.
 */
const PROPOSAL_MESSAGE_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries(PROPOSAL_MESSAGES),
);

function messageFor(moduleId: ModuleTemplateId): string {
  const m = PROPOSAL_MESSAGE_MAP.get(moduleId);
  if (m !== undefined) return m;
  return `${FALLBACK_MESSAGE_PREFIX}${moduleId}.`;
}

// ─────────────────────────────────────────────────────────────────────────
// History indexing — fast lookup by (user, module).
// ─────────────────────────────────────────────────────────────────────────

interface HistoryIndex {
  readonly pending: Map<string, ProposalHistoryEntry>;
  readonly declined: Map<string, ProposalHistoryEntry>;
  readonly snoozed: Map<string, ProposalHistoryEntry>;
}

function historyKey(userId: string, moduleId: ModuleTemplateId): string {
  return `${userId}::${moduleId}`;
}

/** Keep the most-recently-decided row for a given (user, module) key. */
function upsertMostRecent(
  bucket: Map<string, ProposalHistoryEntry>,
  key: string,
  entry: ProposalHistoryEntry,
): void {
  const cur = bucket.get(key);
  if (!cur) {
    bucket.set(key, entry);
    return;
  }
  const incomingAt = entry.decidedAt ?? entry.createdAt;
  const currentAt = cur.decidedAt ?? cur.createdAt;
  if (incomingAt > currentAt) {
    bucket.set(key, entry);
  }
}

function indexHistory(
  history: ReadonlyArray<ProposalHistoryEntry>,
): HistoryIndex {
  const pending = new Map<string, ProposalHistoryEntry>();
  const declined = new Map<string, ProposalHistoryEntry>();
  const snoozed = new Map<string, ProposalHistoryEntry>();
  for (const h of history) {
    const k = historyKey(h.userId, h.suggestedModuleTemplateId);
    if (h.status === 'pending') {
      // Keep the most recent pending row (history is ordered desc by cron).
      if (!pending.has(k)) pending.set(k, h);
    } else if (h.status === 'declined') {
      upsertMostRecent(declined, k, h);
    } else if (h.status === 'snoozed') {
      upsertMostRecent(snoozed, k, h);
    }
  }
  return Object.freeze({ pending, declined, snoozed });
}

// ─────────────────────────────────────────────────────────────────────────
// Main emit planner.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Plan proposal emissions for the supplied aggregations.
 *
 * @returns `EmitPlan` — rows to insert + rows that were skipped (with
 *          reasons, for observability).
 */
export function planEmissions(
  aggregations: readonly AggregatedScore[],
  options: EmitOptions,
): EmitPlan {
  const emit: EmitPlanEntry[] = [];
  const skipped: SkippedEntry[] = [];

  if (aggregations.length === 0) {
    return Object.freeze({ emit, skipped });
  }

  const index = indexHistory(options.history);
  const declineCutoffMs =
    options.now.getTime() - options.declineSnoozeDays * 24 * 60 * 60 * 1000;
  const expiresAtMs =
    options.now.getTime() + options.proposalExpiryDays * 24 * 60 * 60 * 1000;

  for (const agg of aggregations) {
    if (agg.score < options.scoreThreshold) {
      skipped.push({ aggregation: agg, reason: 'below_threshold' });
      continue;
    }
    if (options.installedModuleTemplateIds.has(agg.suggestedModuleTemplateId)) {
      skipped.push({ aggregation: agg, reason: 'module_already_installed' });
      continue;
    }
    const key = historyKey(agg.userId, agg.suggestedModuleTemplateId);
    if (index.pending.has(key)) {
      skipped.push({ aggregation: agg, reason: 'pending_proposal_exists' });
      continue;
    }
    const declined = index.declined.get(key);
    if (declined) {
      const declinedAt = declined.decidedAt ?? declined.createdAt;
      if (declinedAt.getTime() >= declineCutoffMs) {
        skipped.push({ aggregation: agg, reason: 'declined_within_snooze' });
        continue;
      }
    }
    const snoozed = index.snoozed.get(key);
    if (snoozed) {
      const snoozedAt = snoozed.decidedAt ?? snoozed.createdAt;
      // Snooze is 1 scan cycle; we treat any snooze in the last
      // `declineSnoozeDays / 6` window as still active. The cron's
      // expirer flips snoozed→expired/pending on schedule.
      const snoozeWindowMs =
        Math.max(1, Math.floor(options.declineSnoozeDays / 6)) *
        24 *
        60 *
        60 *
        1000;
      if (options.now.getTime() - snoozedAt.getTime() < snoozeWindowMs) {
        skipped.push({ aggregation: agg, reason: 'snoozed_recently' });
        continue;
      }
    }

    emit.push({
      row: {
        id: options.generateId(),
        tenantId: agg.tenantId,
        userId: agg.userId,
        suggestedModuleTemplateId: agg.suggestedModuleTemplateId,
        score: agg.score,
        topSignalIds: [...agg.contributingSignalIds],
        proposalMessage: messageFor(agg.suggestedModuleTemplateId),
        status: 'pending',
        decidedAt: null,
        createdAt: options.now,
        expiresAt: new Date(expiresAtMs),
      },
      reason: 'emitted_above_threshold',
    });
  }

  return Object.freeze({
    emit: Object.freeze(emit),
    skipped: Object.freeze(skipped),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Status transitions — pure functions for cron + decision API.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute the row updates needed to flip overdue pending rows to
 * 'expired'. Cron runs this after planning emissions so an expired
 * row doesn't block a fresh emission in the same cycle.
 */
export function planExpirations(
  pendingRows: ReadonlyArray<{
    readonly id: string;
    readonly expiresAt: Date;
  }>,
  now: Date,
): readonly string[] {
  const out: string[] = [];
  for (const row of pendingRows) {
    if (row.expiresAt.getTime() <= now.getTime()) {
      out.push(row.id);
    }
  }
  return Object.freeze(out);
}

/**
 * Validate a status transition requested via API. Returns null if
 * legal, otherwise an error message.
 */
export function validateTransition(
  current: ProposalStatus,
  next: ProposalStatus,
): string | null {
  if (current === next) return `already in status "${current}"`;
  if (current !== 'pending') {
    return `transition from "${current}" not allowed (only "pending" rows can be decided)`;
  }
  const allowed: ReadonlyArray<ProposalStatus> = [
    'accepted',
    'declined',
    'expired',
    'snoozed',
  ];
  if (!allowed.includes(next)) {
    return `transition from "pending" to "${next}" not allowed`;
  }
  return null;
}
