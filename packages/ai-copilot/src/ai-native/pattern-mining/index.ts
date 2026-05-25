/**
 * Cross-portfolio pattern-mining.
 *
 * Weekly: analyze anonymized cross-tenant signals to surface emergent
 * patterns ("tenants in properties with monthly complaints >3 churn at
 * 2.4× the rate") and publish them back to all tenants as strategic
 * insights via the advisor persona.
 *
 * PRIVACY: aggregation rules enforced server-side — outputs NEVER include
 * tenant identifying data; min 5 tenants per aggregation (MIN_TENANTS_FOR_AGGREGATION).
 * If a pattern draws from fewer than 5 tenants, it is SUPPRESSED.
 *
 * WHY AI-NATIVE: no human can look across hundreds of tenants, anonymize,
 * correlate, and safely publish insights. This capability does that with
 * DPIA-style privacy by design.
 */

import {
  type BudgetGuard,
  type ClassifyLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  newId,
  clamp01,
  MIN_TENANTS_FOR_AGGREGATION,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Anonymized aggregate row — NEVER contains tenantId. This is the only
 * shape allowed to leave the data plane.
 */
export interface AggregateRow {
  readonly segmentKey: string;
  readonly metricKey: string;
  readonly value: number;
  readonly tenantCount: number;
  readonly sampleCount: number;
}

export interface PatternInsight {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly affectedSegments: readonly string[];
  readonly supportingAggregates: readonly AggregateRow[];
  readonly confidence: number;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly publishedAt: string;
}

export interface PatternMiningRepository {
  /**
   * Fetch anonymized aggregate rows. Implementations MUST filter to
   * tenantCount >= MIN_TENANTS_FOR_AGGREGATION before returning; the
   * in-service privacy guard below ALSO re-checks.
   */
  loadAggregates(): Promise<readonly AggregateRow[]>;
}

export interface PatternMiningDeps {
  readonly repo: PatternMiningRepository;
  readonly llm?: ClassifyLLMPort;
  readonly budgetGuard?: BudgetGuard;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Privacy guard — suppress any aggregate below MIN_TENANTS_FOR_AGGREGATION
// ---------------------------------------------------------------------------

export function enforcePrivacyFloor(
  rows: readonly AggregateRow[],
): readonly AggregateRow[] {
  return rows.filter((r) => r.tenantCount >= MIN_TENANTS_FOR_AGGREGATION);
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PATTERN_SYSTEM_PROMPT = `You are a property-portfolio pattern-finder. From anonymized aggregate metrics
across multiple tenants, return strategic insights. Every row guarantees
tenantCount >= 5; do not invent rows. Return ONLY JSON:
{
  "insights": [
    {
      "title": string,
      "description": string (plain language, 1-2 sentences),
      "affectedSegments": string[] (refer to segmentKey values),
      "confidence": number (0..1)
    }
  ]
}
Rules:
- NEVER mention any tenant identifiers (the data doesn't contain them; don't invent them).
- If no pattern meets a 0.5 confidence bar, return "insights": [].`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface PatternMiner {
  runWeekly(): Promise<readonly PatternInsight[]>;
}

export function createPatternMiner(deps: PatternMiningDeps): PatternMiner {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;

  return {
    async runWeekly() {
      const raw = await deps.repo.loadAggregates();
      const safe = enforcePrivacyFloor(raw);
      if (safe.length === 0) return [];

      const system = PATTERN_SYSTEM_PROMPT;
      const user = `Aggregates:\n${JSON.stringify(safe)}`;
      const hash = promptHash(system + '\n---\n' + user);
      const publishedAt = now().toISOString();

      if (!deps.llm) {
        return [
          {
            id: newId('pi'),
            title: 'pattern-mining degraded',
            description:
              'LLM port unavailable; pattern-miner ran on aggregates but could not synthesize insights.',
            affectedSegments: safe.map((r) => r.segmentKey).slice(0, 10),
            supportingAggregates: safe,
            confidence: 0,
            modelVersion: DEGRADED_MODEL_VERSION,
            promptHash: hash,
            publishedAt,
          },
        ];
      }

      // Budget-guard on a SYSTEM-level pattern mining call. We use a sentinel
      // tenantId so the ledger sees it distinct from per-tenant usage.
      await guard('__system__', 'pattern-mining:runWeekly');

      try {
        const res = await deps.llm.classify({ systemPrompt: system, userPrompt: user });
        const parsed = safeJsonParse<{
          insights?: Array<{
            title?: string;
            description?: string;
            affectedSegments?: string[];
            confidence?: number;
          }>;
        }>(res.raw);
        if (!parsed || !Array.isArray(parsed.insights)) return [];
        return parsed.insights.map((i) => ({
          id: newId('pi'),
          title: (i.title ?? 'untitled').slice(0, 200),
          description: (i.description ?? '').slice(0, 1000),
          affectedSegments: Array.isArray(i.affectedSegments)
            ? i.affectedSegments.filter((s): s is string => typeof s === 'string')
            : [],
          supportingAggregates: safe,
          confidence: clamp01(i.confidence),
          modelVersion: res.modelVersion,
          promptHash: hash,
          publishedAt,
        }));
      } catch (err) {
        return [
          {
            id: newId('pi'),
            title: 'pattern-mining error',
            description: `LLM call failed: ${err instanceof Error ? err.message : 'unknown'}`,
            affectedSegments: [],
            supportingAggregates: safe,
            confidence: 0,
            modelVersion: DEGRADED_MODEL_VERSION,
            promptHash: hash,
            publishedAt,
          },
        ];
      }
    },
  };
}
