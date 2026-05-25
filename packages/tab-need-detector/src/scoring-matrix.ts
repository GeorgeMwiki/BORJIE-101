/* eslint-disable borjie/no-jurisdictional-literal --
 * Need-detection scoring registry: KRA / TRA are NER entity-type
 * LABELS (data we recognise across tenants), not jurisdictional
 * business logic. The lookup keys are the canonical entity-type
 * strings that the central-intelligence NER pipeline emits.
 * Allowed per convention used in packages/ai-copilot's pii-scrubber.
 */
/**
 * Piece O — Need-Detection scoring matrix.
 *
 * Maps observed signals to suggested module templates with per-rule
 * weights. Pure constants + pure functions.
 *
 * Rule format:
 *   * `searchKeyword`         — substring (case-insensitive) match
 *   * `entityType`            — NER entity type (uppercase canonical)
 *   * `intentLabel`           — top-level chat intent label
 *   * `docType`               — Piece K classification output
 *   * `tabEventPattern`       — canonical pattern id from Piece L
 *   * `externalTriggerKind`   — connector-defined event name
 *
 * Each rule yields one `MatrixHit` per match → which the observer then
 * persists as a `tab_spawn_signals` row. The aggregator later sums the
 * row weights with half-life decay.
 *
 * Easy to extend: append rules to the matching map. Each map keeps its
 * keys lowercase / uppercase canonical so observers don't have to
 * remember the casing.
 */

import type { ModuleTemplateId, SignalKind } from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// MatrixHit shape — what `evaluateMatrix*` returns.
// ─────────────────────────────────────────────────────────────────────────

export interface MatrixHit {
  readonly suggestedModuleTemplateId: ModuleTemplateId;
  readonly weight: number;
  readonly rule: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Conversation NER → module mapping (entity-type level).
// ─────────────────────────────────────────────────────────────────────────

/**
 * NER entity type → ({moduleId, weight}). Entity types are uppercased
 * canonical labels emitted by the central-intelligence kernel's NER
 * pipeline (see packages/central-intelligence/src/kernel/ner.ts).
 *
 * Multiple entities in a single conversation message produce multiple
 * signals — the aggregator sums them.
 */
export const NER_ENTITY_RULES: ReadonlyArray<{
  readonly entityType: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  // COMPLIANCE — regulators, audits, statutory notices
  { entityType: 'COMPLIANCE', module: 'COMPLIANCE', weight: 1.5 },
  { entityType: 'REGULATION', module: 'COMPLIANCE', weight: 1.2 },
  { entityType: 'AUDIT', module: 'COMPLIANCE', weight: 1.4 },
  { entityType: 'NOTICE', module: 'COMPLIANCE', weight: 0.8 },
  { entityType: 'KRA', module: 'COMPLIANCE', weight: 1.5 },
  { entityType: 'TRA', module: 'COMPLIANCE', weight: 1.5 },
  // LEGAL
  { entityType: 'CONTRACT', module: 'LEGAL', weight: 1.3 },
  { entityType: 'BREACH', module: 'LEGAL', weight: 1.6 },
  { entityType: 'COURT', module: 'LEGAL', weight: 1.7 },
  { entityType: 'LEGAL', module: 'LEGAL', weight: 1.0 },
  { entityType: 'COUNSEL', module: 'LEGAL', weight: 1.2 },
  // HR
  { entityType: 'EMPLOYEE', module: 'HR', weight: 1.2 },
  { entityType: 'SALARY', module: 'HR', weight: 1.4 },
  { entityType: 'LEAVE', module: 'HR', weight: 0.9 },
  { entityType: 'ONBOARD', module: 'HR', weight: 1.1 },
  { entityType: 'PAYROLL', module: 'HR', weight: 1.4 },
  // FLEET
  { entityType: 'VEHICLE', module: 'FLEET', weight: 1.3 },
  { entityType: 'DRIVER', module: 'FLEET', weight: 1.3 },
  { entityType: 'FLEET', module: 'FLEET', weight: 1.5 },
]);

/**
 * Intent label → module. Lighter weight than NER entities (intent is
 * a coarser signal).
 */
export const INTENT_LABEL_RULES: ReadonlyArray<{
  readonly intent: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  { intent: 'compliance_query', module: 'COMPLIANCE', weight: 1.0 },
  { intent: 'legal_query', module: 'LEGAL', weight: 1.0 },
  { intent: 'hr_query', module: 'HR', weight: 1.0 },
  { intent: 'fleet_query', module: 'FLEET', weight: 1.0 },
  { intent: 'procurement_query', module: 'PROCUREMENT', weight: 1.0 },
]);

// ─────────────────────────────────────────────────────────────────────────
// Document doc_type → module mapping.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Piece K's extracted doc_type → module + weight. Doc uploads are the
 * highest-signal source (a user wouldn't bother uploading without intent)
 * so weights here are the largest in the matrix.
 */
export const DOC_TYPE_RULES: ReadonlyArray<{
  readonly docType: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  // COMPLIANCE
  { docType: 'national_id', module: 'COMPLIANCE', weight: 2.0 },
  { docType: 'compliance_certificate', module: 'COMPLIANCE', weight: 3.0 },
  { docType: 'kra_pin_certificate', module: 'COMPLIANCE', weight: 2.5 },
  { docType: 'tra_certificate', module: 'COMPLIANCE', weight: 2.5 },
  { docType: 'safety_certificate', module: 'COMPLIANCE', weight: 2.0 },
  // LEGAL
  { docType: 'contract', module: 'LEGAL', weight: 2.5 },
  { docType: 'court_ruling', module: 'LEGAL', weight: 3.0 },
  { docType: 'legal_opinion', module: 'LEGAL', weight: 2.0 },
  // PROCUREMENT
  { docType: 'vendor_invoice', module: 'PROCUREMENT', weight: 1.5 },
  { docType: 'purchase_order', module: 'PROCUREMENT', weight: 2.0 },
  { docType: 'vendor_quote', module: 'PROCUREMENT', weight: 1.5 },
  // HR
  { docType: 'payslip', module: 'HR', weight: 2.0 },
  { docType: 'employment_contract', module: 'HR', weight: 2.5 },
  // FLEET
  { docType: 'logbook', module: 'FLEET', weight: 2.0 },
  { docType: 'driving_license', module: 'FLEET', weight: 1.8 },
]);

// ─────────────────────────────────────────────────────────────────────────
// Search keyword → module mapping.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lower-case search-keyword fragments → module. Substring match.
 * Weights are deliberately low — search keywords are noisy.
 */
export const SEARCH_KEYWORD_RULES: ReadonlyArray<{
  readonly keyword: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  // COMPLIANCE
  { keyword: 'compliance', module: 'COMPLIANCE', weight: 0.8 },
  { keyword: 'audit', module: 'COMPLIANCE', weight: 0.7 },
  { keyword: 'kra', module: 'COMPLIANCE', weight: 0.9 },
  { keyword: 'tra', module: 'COMPLIANCE', weight: 0.9 },
  { keyword: 'tax', module: 'COMPLIANCE', weight: 0.5 },
  // LEGAL
  { keyword: 'contract', module: 'LEGAL', weight: 0.6 },
  { keyword: 'lawsuit', module: 'LEGAL', weight: 1.0 },
  { keyword: 'court', module: 'LEGAL', weight: 0.8 },
  { keyword: 'legal', module: 'LEGAL', weight: 0.7 },
  // HR
  { keyword: 'employee', module: 'HR', weight: 0.7 },
  { keyword: 'payroll', module: 'HR', weight: 0.8 },
  { keyword: 'salary', module: 'HR', weight: 0.7 },
  { keyword: 'leave', module: 'HR', weight: 0.5 },
  // FLEET
  { keyword: 'fleet', module: 'FLEET', weight: 1.0 },
  { keyword: 'vehicle', module: 'FLEET', weight: 0.8 },
  { keyword: 'driver', module: 'FLEET', weight: 0.7 },
  // PROCUREMENT
  { keyword: 'procurement', module: 'PROCUREMENT', weight: 1.0 },
  { keyword: 'purchase', module: 'PROCUREMENT', weight: 0.5 },
  { keyword: 'vendor', module: 'PROCUREMENT', weight: 0.6 },
]);

// ─────────────────────────────────────────────────────────────────────────
// Tab event pattern → module.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Canonical pattern ids → module + weight. Patterns are emitted by
 * Piece L's tab event log scanner. Examples:
 *   - 'finance_visits_no_action' → STRATEGY (user needs higher-level view)
 *   - 'repeated_search_no_results' → low weight + generic
 */
export const TAB_EVENT_PATTERN_RULES: ReadonlyArray<{
  readonly pattern: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  { pattern: 'finance_visits_no_action', module: 'STRATEGY', weight: 1.5 },
  { pattern: 'reports_visits_no_export', module: 'STRATEGY', weight: 1.2 },
  { pattern: 'compliance_search_repeated', module: 'COMPLIANCE', weight: 1.4 },
]);

// ─────────────────────────────────────────────────────────────────────────
// External trigger → module.
// ─────────────────────────────────────────────────────────────────────────

/**
 * (source, kind) pairs → module + weight. Connector signals are
 * high-confidence — defaults are weighted accordingly.
 */
export const EXTERNAL_TRIGGER_RULES: ReadonlyArray<{
  readonly source: string;
  readonly kind: string;
  readonly module: ModuleTemplateId;
  readonly weight: number;
}> = Object.freeze([
  { source: 'kra', kind: 'compliance_notice', module: 'COMPLIANCE', weight: 3.0 },
  { source: 'tra', kind: 'compliance_notice', module: 'COMPLIANCE', weight: 3.0 },
  { source: 'court_registry', kind: 'case_filed', module: 'LEGAL', weight: 3.5 },
]);

// ─────────────────────────────────────────────────────────────────────────
// Evaluators — pure functions.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a search query against the keyword matrix. Returns one hit
 * per matched keyword (a query may match more than one — they're all
 * persisted as separate signal rows).
 */
export function evaluateSearchQuery(query: string): readonly MatrixHit[] {
  if (!query || typeof query !== 'string') return [];
  const lowered = query.toLowerCase();
  const hits: MatrixHit[] = [];
  for (const rule of SEARCH_KEYWORD_RULES) {
    if (lowered.includes(rule.keyword)) {
      hits.push({
        suggestedModuleTemplateId: rule.module,
        weight: rule.weight,
        rule: `search:${rule.keyword}`,
      });
    }
  }
  return hits;
}

/**
 * Evaluate a list of NER entities against the matrix. Returns one hit
 * per matched entity type. Duplicate entities of the same type produce
 * one hit per occurrence — the aggregator decays by recency, not count.
 */
export function evaluateNerEntities(
  entities: ReadonlyArray<readonly [string, string]>,
): readonly MatrixHit[] {
  if (!Array.isArray(entities) || entities.length === 0) return [];
  const hits: MatrixHit[] = [];
  for (const entity of entities) {
    if (!entity || entity.length < 1) continue;
    const entityType = entity[0]?.toUpperCase();
    if (!entityType) continue;
    for (const rule of NER_ENTITY_RULES) {
      if (rule.entityType === entityType) {
        hits.push({
          suggestedModuleTemplateId: rule.module,
          weight: rule.weight,
          rule: `ner:${entityType}`,
        });
      }
    }
  }
  return hits;
}

/**
 * Evaluate a (lower-case) intent label against the matrix.
 */
export function evaluateIntentLabel(
  intent: string | undefined,
): readonly MatrixHit[] {
  if (!intent || typeof intent !== 'string') return [];
  const lowered = intent.toLowerCase();
  const hits: MatrixHit[] = [];
  for (const rule of INTENT_LABEL_RULES) {
    if (rule.intent === lowered) {
      hits.push({
        suggestedModuleTemplateId: rule.module,
        weight: rule.weight,
        rule: `intent:${lowered}`,
      });
    }
  }
  return hits;
}

/**
 * Evaluate a doc_type against the matrix.
 */
export function evaluateDocType(docType: string): readonly MatrixHit[] {
  if (!docType || typeof docType !== 'string') return [];
  const lowered = docType.toLowerCase();
  const hits: MatrixHit[] = [];
  for (const rule of DOC_TYPE_RULES) {
    if (rule.docType === lowered) {
      hits.push({
        suggestedModuleTemplateId: rule.module,
        weight: rule.weight,
        rule: `doc:${lowered}`,
      });
    }
  }
  return hits;
}

/**
 * Evaluate a tab event pattern id against the matrix.
 */
export function evaluateTabEventPattern(
  pattern: string,
): readonly MatrixHit[] {
  if (!pattern || typeof pattern !== 'string') return [];
  const hits: MatrixHit[] = [];
  for (const rule of TAB_EVENT_PATTERN_RULES) {
    if (rule.pattern === pattern) {
      hits.push({
        suggestedModuleTemplateId: rule.module,
        weight: rule.weight,
        rule: `pattern:${pattern}`,
      });
    }
  }
  return hits;
}

/**
 * Evaluate an external trigger against the matrix.
 */
export function evaluateExternalTrigger(
  source: string,
  kind: string,
): readonly MatrixHit[] {
  if (!source || !kind) return [];
  const sl = source.toLowerCase();
  const kl = kind.toLowerCase();
  const hits: MatrixHit[] = [];
  for (const rule of EXTERNAL_TRIGGER_RULES) {
    if (rule.source.toLowerCase() === sl && rule.kind.toLowerCase() === kl) {
      hits.push({
        suggestedModuleTemplateId: rule.module,
        weight: rule.weight,
        rule: `ext:${sl}:${kl}`,
      });
    }
  }
  return hits;
}

/**
 * Default per-kind weight (used when a signal lands without a matrix
 * lookup, e.g. an external trigger we don't recognise but still want
 * to record). Returns 0 for unknown kinds so unmapped signals don't
 * accidentally vote.
 */
export function defaultWeightForKind(kind: SignalKind): number {
  switch (kind) {
    case 'doc_upload':
      return 1.5;
    case 'conversation_intent':
      return 1.0;
    case 'tab_event_pattern':
      return 1.0;
    case 'external_trigger':
      return 1.0;
    case 'search_keyword':
      return 0.5;
    default:
      return 0;
  }
}
