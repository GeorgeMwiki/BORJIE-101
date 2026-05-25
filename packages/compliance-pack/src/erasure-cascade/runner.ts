/**
 * Cascade runner — produces an idempotent erasure manifest.
 *
 * The runner is PURE: it takes a cascade spec + the rows collected
 * for the subject and returns the manifest of actions. It does NOT
 * mutate the database — the integration layer wraps the manifest in
 * a transaction and applies each action atomically.
 *
 * The manifest is deterministic: same spec + same rows ⇒ same
 * manifest. This is the property that makes replay safe after an
 * interruption.
 *
 * Legal-hold priority: rules with `strategy: 'legal_hold'` ALWAYS
 * win over any other rule on the same table; the runner emits a
 * `held_because` action and leaves the row alone.
 */

import { strategyPriority, strongerStrategy } from './strategies.js';
import type {
  DSARRecord,
  ErasureAction,
  ErasureCascadeSpec,
  ErasureReport,
  ErasureStrategy,
} from '../types.js';

export interface CascadeRunner {
  run(params: {
    readonly cascadeId: string;
    readonly subjectId: string;
    readonly cascade: ErasureCascadeSpec;
    readonly records: ReadonlyArray<DSARRecord>;
    readonly now?: (() => Date) | undefined;
  }): Promise<ErasureReport>;
}

/**
 * Build a cascade runner. Pure-functional core; no I/O. Returns a
 * runner whose `run` method always resolves (errors are encoded in
 * the manifest as `held_because: 'no_rule_for_table'` or similar).
 */
export function buildErasureCascade(): CascadeRunner {
  return {
    async run({ cascadeId, subjectId, cascade, records, now }): Promise<ErasureReport> {
      const clock = now ?? (() => new Date());
      const at = clock();

      // 1. Collapse duplicate rules per table — strongest wins.
      const rulesByTable = collapseRules(cascade);

      // 2. Plan one action per record.
      const actions: ErasureAction[] = [];
      for (const record of records) {
        const rule = rulesByTable.get(record.table);
        if (!rule) {
          // No rule — the cascade engine fails CLOSED: no action.
          // Rationale: untouched data is safer than accidentally
          // erased data. Operators must explicitly declare every
          // PII-bearing table.
          actions.push({
            table: record.table,
            primaryKey: record.primaryKey,
            strategy: 'legal_hold',
            columnsAffected: [],
            heldBecause: 'no_rule_declared_for_table',
          });
          continue;
        }

        if (rule.strategy === 'legal_hold') {
          actions.push({
            table: record.table,
            primaryKey: record.primaryKey,
            strategy: 'legal_hold',
            columnsAffected: [],
            heldBecause: rule.retentionReason ?? 'legal_hold_no_reason',
          });
          continue;
        }

        // Active strategy — the runner records exactly which columns
        // are affected. The integration layer applies the transform.
        actions.push({
          table: record.table,
          primaryKey: record.primaryKey,
          strategy: rule.strategy,
          columnsAffected: rule.piiColumns,
        });
      }

      // 3. Summary counts per strategy — used by audit reports.
      const summary = summariseActions(actions);

      return Object.freeze({
        cascadeId,
        subjectId,
        tenantId: cascade.tenantId,
        producedAt: at.toISOString(),
        actions: Object.freeze(actions),
        summary,
      });
    },
  };
}

function collapseRules(cascade: ErasureCascadeSpec) {
  const out = new Map<
    string,
    {
      readonly table: string;
      readonly strategy: ErasureStrategy;
      readonly piiColumns: ReadonlyArray<string>;
      readonly retentionReason?: string | undefined;
      readonly retentionUntil?: string | undefined;
    }
  >();
  for (const rule of cascade.rules) {
    const existing = out.get(rule.table);
    if (!existing) {
      out.set(rule.table, rule);
      continue;
    }
    // If either is legal_hold, legal_hold wins.
    if (existing.strategy === 'legal_hold' || rule.strategy === 'legal_hold') {
      const heldRule = existing.strategy === 'legal_hold' ? existing : rule;
      out.set(rule.table, heldRule);
      continue;
    }
    // Otherwise stronger wins; if equal strength, second declaration
    // wins (deterministic, follows source-of-truth principle).
    const stronger = strongerStrategy(existing.strategy, rule.strategy);
    if (strategyPriority(stronger) === strategyPriority(rule.strategy)) {
      out.set(rule.table, rule);
    }
  }
  return out;
}

function summariseActions(actions: ReadonlyArray<ErasureAction>) {
  let hardDeleted = 0,
    anonymized = 0,
    pseudonymized = 0,
    tombstoned = 0,
    legalHold = 0;
  for (const a of actions) {
    switch (a.strategy) {
      case 'hard_delete':
        hardDeleted += 1;
        break;
      case 'anonymize':
        anonymized += 1;
        break;
      case 'pseudonymize':
        pseudonymized += 1;
        break;
      case 'tombstone':
        tombstoned += 1;
        break;
      case 'legal_hold':
        legalHold += 1;
        break;
    }
  }
  return Object.freeze({
    hardDeleted,
    anonymized,
    pseudonymized,
    tombstoned,
    legalHold,
  });
}
