/**
 * Persona-aware filter for the entity-index query layer.
 *
 * The same `entity.search` / `entity.resolve` / `entity.full_picture`
 * query under owner JWT vs worker JWT must return:
 *
 *   1. DIFFERENT ROWS  — workers see only sites they've worked at;
 *      owners see the full estate. Enforced by the RLS GUC + the
 *      `scopeIds` projection here.
 *
 *   2. DIFFERENT FIELDS — financial figures and counterparty payouts
 *      are redacted for workers. Owners see them in clear. Enforced
 *      by the post-query field redactor here.
 *
 *   3. DIFFERENT VOCABULARY — workers get worker-appropriate summary
 *      text ("Buy job at Mwadui pit B") not exec language ("$2.4M
 *      cobalt offtake for Tabora Catering Q2"). The summary swap is
 *      keyed off the persona slug.
 *
 * Pure, dependency-free. No DB / HTTP / I/O. The query layer calls
 * this both BEFORE the SQL (to compute the persona scope projection)
 * and AFTER (to redact + rewrite the rows). The two-pass design keeps
 * the SQL itself simple and the redactor centralised.
 *
 * Tenant isolation: the RLS GUC remains the authoritative tenant cap;
 * this layer adds the persona ceiling on top. Both must be in place
 * for a row to surface.
 *
 * Persona slugs (from `BUILT_IN_PERSONAS`):
 *
 *   T1_owner_strategist  — full picture, no redaction
 *   T2_admin_strategist  — full picture, no redaction
 *   T3_module_manager    — scope-limited to sites the manager owns,
 *                          financials visible at site-scope
 *   T4_field_employee    — scope-limited to sites the worker has
 *                          shifted at, financials REDACTED, summary
 *                          rewritten to worker vocabulary
 *   T5_customer_concierge — buyer-scoped; only entities the buyer's
 *                          counterparties surface; financials REDACTED
 *   T_auditor            — full picture (read-only)
 *   T_vendor             — vendor-scoped to own contracts only
 */

export const ENTITY_INDEX_PERSONAS = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
  'T4_field_employee',
  'T5_customer_concierge',
  'T_auditor',
  'T_vendor',
] as const;
export type EntityIndexPersona = (typeof ENTITY_INDEX_PERSONAS)[number];

/**
 * Fields the post-query redactor will strip for workers + buyers.
 *
 * The kind-specific list lives in code because the rule is "treat any
 * money / payout / counterparty PII as sensitive". The shape mirrors
 * the entity_index row's `summary` + `tags` JSON; the redactor walks
 * both and replaces matches with the bilingual placeholder.
 */
const SENSITIVE_PATTERNS_EN: ReadonlyArray<RegExp> = Object.freeze([
  /\$\s*[\d,]+(\.\d+)?\s*(M|K|million|thousand)?/gi,
  /TZS\s*[\d,]+(\.\d+)?\s*(M|K|million|thousand)?/gi,
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, // bare large numbers
  /royalty\s+\d/gi,
  /payout\s+\d/gi,
]);

const SENSITIVE_PATTERNS_SW: ReadonlyArray<RegExp> = Object.freeze([
  /TZS\s*[\d,]+(\.\d+)?\s*(M|K|milioni|elfu)?/gi,
  /malipo\s+\d/gi,
  /mrabaha\s+\d/gi,
]);

const REDACTED_LABEL: Record<'en' | 'sw', string> = {
  en: '[redacted]',
  sw: '[siri]',
};

/**
 * Worker-appropriate vocabulary swap. Keyed off the entity kind so
 * the brain returns "Buy job at Mwadui pit B" instead of "$2.4M
 * cobalt offtake for Tabora Catering Q2".
 *
 * The full vocabulary lives in the entity-index seed; this table is
 * a fallback for kinds we have not yet seeded.
 */
const WORKER_KIND_VOCAB: Record<string, { en: string; sw: string }> = {
  offtake_contract: { en: 'Buy job', sw: 'Kazi ya ununuzi' },
  royalty_filing: { en: 'Government filing', sw: 'Faili la serikali' },
  marketplace_bid: { en: 'Buy offer', sw: 'Tangazo la ununuzi' },
  payout: { en: 'Payment job', sw: 'Kazi ya malipo' },
};

export interface EntityIndexRow {
  readonly kind: string;
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly tags?: ReadonlyArray<string>;
  readonly lifecycleStage?: string;
  readonly refreshedAt?: string;
  readonly scopeId?: string | null;
  /** Free-form per-kind metadata (counterparty, TZS amounts, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PersonaProjection {
  readonly persona: EntityIndexPersona;
  /** When non-null, the SQL must filter `scope_id IN (...)` to this set. */
  readonly scopeIdsAllowed: ReadonlyArray<string> | null;
  /** Whether the post-query redactor must scrub money + counterparty fields. */
  readonly redactFinancials: boolean;
  /** Whether the summary should be rewritten to worker-vocabulary. */
  readonly rewriteWorkerVocab: boolean;
  /** Whether buyer/vendor sees only their own counterparty rows. */
  readonly buyerScopeRequired: boolean;
}

export interface PersonaFilterInput {
  readonly persona: EntityIndexPersona;
  /** Sites the actor's RLS scope covers (from the auth context). */
  readonly actorScopeIds: ReadonlyArray<string>;
  /** Optional buyer / vendor counterparty id (T5 / T_vendor only). */
  readonly counterpartyId?: string | null;
}

/**
 * Compute the persona projection that drives the SQL filter shape.
 * Pure; safe to call inside the query layer.
 */
export function computePersonaProjection(
  input: PersonaFilterInput,
): PersonaProjection {
  const { persona, actorScopeIds, counterpartyId } = input;
  switch (persona) {
    case 'T1_owner_strategist':
    case 'T2_admin_strategist':
    case 'T_auditor':
      return Object.freeze({
        persona,
        scopeIdsAllowed: null,
        redactFinancials: false,
        rewriteWorkerVocab: false,
        buyerScopeRequired: false,
      });
    case 'T3_module_manager':
      return Object.freeze({
        persona,
        scopeIdsAllowed: Object.freeze(actorScopeIds.slice()),
        redactFinancials: false,
        rewriteWorkerVocab: false,
        buyerScopeRequired: false,
      });
    case 'T4_field_employee':
      return Object.freeze({
        persona,
        scopeIdsAllowed: Object.freeze(actorScopeIds.slice()),
        redactFinancials: true,
        rewriteWorkerVocab: true,
        buyerScopeRequired: false,
      });
    case 'T5_customer_concierge':
      return Object.freeze({
        persona,
        scopeIdsAllowed: null,
        redactFinancials: true,
        rewriteWorkerVocab: false,
        buyerScopeRequired: counterpartyId != null,
      });
    case 'T_vendor':
      return Object.freeze({
        persona,
        scopeIdsAllowed: null,
        redactFinancials: true,
        rewriteWorkerVocab: false,
        buyerScopeRequired: counterpartyId != null,
      });
  }
}

function redactText(text: string, language: 'en' | 'sw'): string {
  const patterns = language === 'sw' ? SENSITIVE_PATTERNS_SW : SENSITIVE_PATTERNS_EN;
  return patterns.reduce(
    (acc, pattern) => acc.replace(pattern, REDACTED_LABEL[language]),
    text,
  );
}

function rewriteWorkerSummary(
  row: EntityIndexRow,
  language: 'en' | 'sw',
): string {
  const vocab = WORKER_KIND_VOCAB[row.kind];
  if (!vocab) return row.summary;
  // Strip counterparty + figures; leave the location / pit anchor.
  const scrubbed = redactText(row.summary, language);
  return `${vocab[language]} — ${scrubbed}`;
}

/**
 * Apply the persona projection to the rows returned by the SQL.
 * Returns a new row array; never mutates the input.
 */
export function applyPersonaFilter(
  rows: ReadonlyArray<EntityIndexRow>,
  projection: PersonaProjection,
  language: 'en' | 'sw' = 'en',
): ReadonlyArray<EntityIndexRow> {
  if (
    !projection.redactFinancials &&
    !projection.rewriteWorkerVocab &&
    projection.scopeIdsAllowed === null
  ) {
    // Owner / admin / auditor path — fast no-op.
    return rows;
  }

  const scopeSet =
    projection.scopeIdsAllowed === null
      ? null
      : new Set(projection.scopeIdsAllowed);

  const out: EntityIndexRow[] = [];
  for (const row of rows) {
    // Scope filter — drop rows outside the allowed scope.
    if (scopeSet !== null && row.scopeId != null && !scopeSet.has(row.scopeId)) {
      continue;
    }

    let summary = row.summary;
    let metadata = row.metadata;
    if (projection.rewriteWorkerVocab) {
      summary = rewriteWorkerSummary(row, language);
    } else if (projection.redactFinancials) {
      summary = redactText(summary, language);
    }
    if (projection.redactFinancials && metadata) {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(metadata)) {
        // Drop any field whose key contains money / counterparty hints.
        if (
          /amount|tzs|usd|payout|royalty|cost|price|counterparty|nida|tin/i.test(
            key,
          )
        ) {
          filtered[key] = REDACTED_LABEL[language];
        } else {
          filtered[key] = value;
        }
      }
      metadata = Object.freeze(filtered);
    }

    out.push(
      Object.freeze({
        ...row,
        summary,
        ...(metadata !== undefined && { metadata }),
      }),
    );
  }
  return Object.freeze(out);
}
