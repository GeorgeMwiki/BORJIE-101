/**
 * Public types for the brilliant intent-inferrer (Wave COMPANY-BRAIN Y-A).
 *
 * Pure types. No runtime side-effects.
 *
 * The inferrer is the post-ingestion analysis brain — it takes the
 * deterministic facts the ingestion pipeline already produced (entity
 * counts, dominant categories, time-spans) plus a sliced sample of the
 * actual chunk text, and produces a structured `IngestIntent` that the
 * owner cockpit renders as a single inline confirmation card:
 *
 *   "I see 50 buyers across 5 mineral kinds and Q1-Q4. Want me to:
 *    [+] Catalog top-12 buyers as a Buyers Tab
 *    [+] Set up a Gold Sales by Region tab
 *    [+] Flag opportunity: Buyer ABC stopped buying in May — re-engage?
 *    [+] Flag risk: 12 sales lack chain-of-custody — backfill?"
 *
 * Brilliance markers (encoded in the schema, enforced by the LLM
 * prompt + structural validation):
 *   - every proposal MUST cite at least one evidence id (chunk / row)
 *   - every proposal MUST have a `reason` string the owner can read
 *   - the inferrer NEVER hallucinates entities; it can only refer to
 *     entities the knowledge-graph grower already discovered (the
 *     allowlist is passed in via `availableEntities`).
 */

import type { IngestReceipt } from '../brain-ingestion/types.js';

/** What the inferrer reads — the deterministic post-ingest snapshot. */
export interface IngestSnapshot {
  readonly receipt: IngestReceipt;
  /** Filename + source kind so the LLM frames the ask correctly. */
  readonly filename: string;
  readonly sourceKind: string;
  /** Bilingual digest + key facts the summarizer already produced. */
  readonly summaryEn: string | null;
  readonly summarySw: string | null;
  readonly keyFacts: ReadonlyArray<{
    readonly kind: string;
    readonly value: string;
    readonly confidence: number;
  }>;
  /** Entities the knowledge-graph grower discovered for this upload. */
  readonly availableEntities: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly displayName: string;
  }>;
  /** A sample of chunk text the inferrer is allowed to read. */
  readonly chunkSamples: ReadonlyArray<{
    readonly chunkId: string;
    readonly excerpt: string;
  }>;
  /** Detected language ('en' | 'sw' | 'unknown'). */
  readonly detectedLanguage: 'en' | 'sw' | 'unknown';
}

/** Tab the inferrer proposes spawning. */
export interface ProposedTab {
  readonly tabType: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly reasonEn: string;
  readonly reasonSw: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
  /** Spawn config the FE tab-store reads after the owner accepts. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** Reminder the inferrer proposes scheduling. */
export interface ProposedReminder {
  readonly titleEn: string;
  readonly titleSw: string;
  readonly bodyEn: string;
  readonly bodySw: string;
  readonly triggerAtIso: string;
  readonly channel: 'email' | 'sms' | 'slack';
  readonly reasonEn: string;
  readonly reasonSw: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
}

/** Opportunity the inferrer surfaces. */
export interface ProposedOpportunity {
  readonly kind: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly reasonEn: string;
  readonly reasonSw: string;
  readonly expectedValueTzs: number | null;
  readonly timeWindowDays: number;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
}

/** Risk the inferrer surfaces. */
export interface ProposedRisk {
  readonly kind: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly reasonEn: string;
  readonly reasonSw: string;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
}

/** The structured output the inferrer returns. */
export interface IngestIntent {
  readonly proposedTabs: ReadonlyArray<ProposedTab>;
  readonly proposedReminders: ReadonlyArray<ProposedReminder>;
  readonly proposedOpportunities: ReadonlyArray<ProposedOpportunity>;
  readonly proposedRisks: ReadonlyArray<ProposedRisk>;
  /** 0..1 overall confidence in the proposal set. */
  readonly confidence: number;
  /** Short bilingual narrative — drives the inline card header. */
  readonly narrativeEn: string;
  readonly narrativeSw: string;
  /** Token-level identifier of the inferrer reasoning path; logged. */
  readonly reasonTag: string;
  /** Provider name (anthropic | openai | deepseek | heuristic). */
  readonly provider: string;
  readonly generatedAtIso: string;
}
