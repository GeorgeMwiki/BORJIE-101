/**
 * Min-tier policy enforcement — Borjie real-estate task categories.
 *
 * Ported from LITFIN `src/core/security/model-policy.ts` (262 LOC).
 * Adapted to BORJIE `ModelFamily` taxonomy + real-estate domain.
 *
 * **Why this exists:** cost-aware routing can silently downgrade a
 * lease-drafting / eviction-notice / financial-advice call to a Haiku-
 * class model. That's a legal-significance regression. This module
 * enforces a per-task-category minimum family floor; cost-cap can
 * REFUSE a call, but it can NEVER downgrade through this floor.
 *
 * Contract:
 *   - Pure functions; no I/O.
 *   - 500-entry bounded ring buffer for enforcement audit (in-memory).
 *   - Unknown categories pass through unchanged (open-world).
 *   - Logger port: silent by default. Composition root sets a real
 *     Pino logger via `setMinTierLogger()`.
 *
 * Real-estate categories:
 *   - lease_drafting / eviction_notice / financial_advice /
 *     legal_review / tenant_screening / rent_calculation /
 *     compliance_check / contract_extraction → must be sonnet+ (most)
 *     or opus (legal).
 *   - inspection_report / maintenance_triage / document_summary /
 *     translation → any model OK; default to haiku-class.
 *   - casual_chat → any model (lowest floor).
 */

import { type ModelFamily, isModelFamily } from './baselines.js';

// ───────────────────────────── Types ─────────────────────────────

export type TaskCategory =
  | 'lease_drafting'
  | 'eviction_notice'
  | 'financial_advice'
  | 'legal_review'
  | 'tenant_screening'
  | 'rent_calculation'
  | 'compliance_check'
  | 'contract_extraction'
  | 'inspection_report'
  | 'maintenance_triage'
  | 'document_summary'
  | 'casual_chat'
  | 'translation';

export interface ModelRequirement {
  readonly minFamily: ModelFamily;
  readonly reason: string;
}

export interface EnforceResult {
  readonly resolved: ModelFamily;
  readonly upgraded: boolean;
  readonly reason: string | null;
  readonly original: ModelFamily;
}

export interface EnforcementLogEntry {
  readonly timestampMs: number;
  readonly taskCategory: string;
  readonly originalFamily: ModelFamily;
  readonly enforcedFamily: ModelFamily;
  readonly reason: string;
}

// ─────────────────────── Policy configuration ──────────────────────

/**
 * Per-task minimum family. Legal/financial → opus (highest reasoning).
 * Operational → sonnet (reliable extraction). Casual → haiku (fast).
 *
 * Tasks NOT listed pass through unchanged (open-world).
 */
export const MODEL_REQUIREMENTS: Readonly<Record<TaskCategory, ModelRequirement>> =
  Object.freeze({
    lease_drafting: {
      minFamily: 'opus',
      reason: 'Lease contracts are legally binding; opus-class precision required',
    },
    eviction_notice: {
      minFamily: 'opus',
      reason: 'Eviction notices are jurisdictionally regulated; opus required',
    },
    financial_advice: {
      minFamily: 'opus',
      reason: 'Investment guidance is legally significant; opus required',
    },
    legal_review: {
      minFamily: 'opus',
      reason: 'Statutory review demands highest reasoning tier',
    },
    tenant_screening: {
      minFamily: 'sonnet',
      reason: 'Fair-housing law sensitivity; sonnet-class minimum',
    },
    rent_calculation: {
      minFamily: 'sonnet',
      reason: 'Money math must be exact; sonnet-class minimum',
    },
    compliance_check: {
      minFamily: 'sonnet',
      reason: 'Regulatory compliance scoring; sonnet minimum',
    },
    contract_extraction: {
      minFamily: 'sonnet',
      reason: 'Structured extraction quality matters; sonnet minimum',
    },
    inspection_report: {
      minFamily: 'haiku',
      reason: 'Field reports allow any model',
    },
    maintenance_triage: {
      minFamily: 'haiku',
      reason: 'Triage is routine; any model OK',
    },
    document_summary: {
      minFamily: 'haiku',
      reason: 'Summaries permissible at fast tier',
    },
    casual_chat: {
      minFamily: 'haiku',
      reason: 'Tenant chat OK on any model',
    },
    translation: {
      minFamily: 'haiku',
      reason: 'EN/SW translation OK on any model',
    },
  });

// ────────────────── Family rank (numeric comparison) ────────────────

/**
 * Numeric rank for family comparison. Higher = more capable.
 * Only Claude families and GPT-5 family are scored — others (whisper,
 * tts, embed) are non-text-reasoning and exit the rank map.
 *
 * The rank space is intentionally sparse to leave room for future
 * tiers without renumbering everything.
 */
const FAMILY_RANK: Readonly<Partial<Record<ModelFamily, number>>> = Object.freeze({
  haiku: 1,
  'gpt-5-mini': 1,
  'gemini-flash': 1,
  'deepseek-chat': 1,
  sonnet: 3,
  'gpt-5': 3,
  'gemini-pro': 3,
  'deepseek-coder': 3,
  opus: 5,
});

/** Returns the numeric rank for a family, or `0` if unranked. */
function rankOf(family: ModelFamily): number {
  return FAMILY_RANK[family] ?? 0;
}

/** True iff `candidate` meets or exceeds `floor`. */
function meetsFloor(candidate: ModelFamily, floor: ModelFamily): boolean {
  return rankOf(candidate) >= rankOf(floor);
}

// ─────────────────── Enforcement log (bounded ring) ─────────────────

const MAX_LOG_ENTRIES = 500;
const enforcementLog: EnforcementLogEntry[] = [];

function appendLogEntry(entry: EnforcementLogEntry): void {
  enforcementLog.push(entry);
  if (enforcementLog.length > MAX_LOG_ENTRIES) {
    enforcementLog.splice(0, enforcementLog.length - MAX_LOG_ENTRIES);
  }
}

/** Read-only snapshot of recent enforcement events. */
export function getEnforcementLog(): ReadonlyArray<EnforcementLogEntry> {
  return [...enforcementLog];
}

/** Counts grouped by task category — for the admin dashboard. */
export function getEnforcementStats(): Readonly<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const entry of enforcementLog) {
    stats[entry.taskCategory] = (stats[entry.taskCategory] ?? 0) + 1;
  }
  return stats;
}

/** Test hook: wipe the in-memory ring buffer. */
export function __resetEnforcementLog(): void {
  enforcementLog.length = 0;
}

// ─────────────────── Optional logger / audit sink ───────────────────

export interface MinTierLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export type EnforcementAuditSink = (entry: EnforcementLogEntry) => void;

let injectedLogger: MinTierLogger | null = null;
let injectedAuditSink: EnforcementAuditSink | null = null;

export function setMinTierLogger(logger: MinTierLogger): void {
  injectedLogger = logger;
}

export function setEnforcementAuditSink(sink: EnforcementAuditSink): void {
  injectedAuditSink = sink;
}

export function clearMinTierLogger(): void {
  injectedLogger = null;
}

export function clearEnforcementAuditSink(): void {
  injectedAuditSink = null;
}

// ───────────────────────── Public API ─────────────────────────────

/**
 * Enforce the minimum family floor for a task category.
 *
 * If `selected` meets or exceeds the floor, returns `{ resolved:
 * selected, upgraded: false }`. Otherwise upgrades to `floor`, logs
 * the enforcement to the ring buffer, fires the audit sink (if any),
 * and returns `{ resolved: floor, upgraded: true, reason }`.
 *
 * Unknown categories pass through unchanged.
 */
export function enforceMinTier(
  taskCategory: TaskCategory | string,
  selected: ModelFamily,
): EnforceResult {
  if (!isModelFamily(selected)) {
    // Should be impossible given the input type, but stay safe.
    return {
      resolved: selected,
      upgraded: false,
      reason: null,
      original: selected,
    };
  }

  const requirement = MODEL_REQUIREMENTS[taskCategory as TaskCategory];
  if (!requirement) {
    return {
      resolved: selected,
      upgraded: false,
      reason: null,
      original: selected,
    };
  }

  if (meetsFloor(selected, requirement.minFamily)) {
    return {
      resolved: selected,
      upgraded: false,
      reason: null,
      original: selected,
    };
  }

  // Upgrade
  const entry: EnforcementLogEntry = {
    timestampMs: Date.now(),
    taskCategory,
    originalFamily: selected,
    enforcedFamily: requirement.minFamily,
    reason: requirement.reason,
  };
  appendLogEntry(entry);

  if (injectedLogger) {
    injectedLogger.warn(
      {
        taskCategory,
        from: selected,
        to: requirement.minFamily,
        reason: requirement.reason,
      },
      '[min-tier-policy] family upgrade enforced',
    );
  }

  if (injectedAuditSink) {
    try {
      injectedAuditSink(entry);
    } catch {
      // Audit-sink errors must not crash the LLM path.
    }
  }

  return {
    resolved: requirement.minFamily,
    upgraded: true,
    reason: requirement.reason,
    original: selected,
  };
}

/** True iff the task requires an opus-class family. */
export function requiresOpusFamily(taskCategory: TaskCategory | string): boolean {
  const requirement = MODEL_REQUIREMENTS[taskCategory as TaskCategory];
  return requirement?.minFamily === 'opus';
}

/** True iff the task requires at least sonnet-class. */
export function requiresSonnetOrBetter(
  taskCategory: TaskCategory | string,
): boolean {
  const requirement = MODEL_REQUIREMENTS[taskCategory as TaskCategory];
  if (!requirement) return false;
  return rankOf(requirement.minFamily) >= rankOf('sonnet');
}
