/**
 * The operator's controlling Chart of Accounts — DERIVED from the REA ontology
 * so the books and the economic model can never drift. Each ontology resource
 * materializes one controlling GL account (sub-accounts hang off these later).
 * Codes follow the conventional IFRS-for-SMEs ranges so a reader instantly
 * knows the class from the number.
 */

import type { ResourceDef } from '@borjie/business-ontology';
import { operatorBusinessOntology } from './ontology.js';

export interface GlAccount {
  readonly code: string; // '1010', '2010', … — class-ranged
  readonly name: string;
  readonly accountClass: ResourceDef['accountClass'];
  /** The ontology resource this controlling account materializes. */
  readonly resourceKey: string;
}

/** Conventional first-digit ranges: asset 1, liability 2, equity 3, revenue 4,
 * expense 5, operational (non-financial) 9. */
const CLASS_BASE: Readonly<Record<ResourceDef['accountClass'], number>> = {
  asset: 1000,
  liability: 2000,
  equity: 3000,
  revenue: 4000,
  expense: 5000,
  operational: 9000,
};

/** Derive the controlling chart-of-accounts from the operator ontology. */
export function deriveChartOfAccounts(): ReadonlyArray<GlAccount> {
  const nextInClass = new Map<ResourceDef['accountClass'], number>();
  return operatorBusinessOntology.resources.map((r) => {
    const seq = (nextInClass.get(r.accountClass) ?? 0) + 10;
    nextInClass.set(r.accountClass, seq);
    return {
      code: String(CLASS_BASE[r.accountClass] + seq),
      name: r.label,
      accountClass: r.accountClass,
      resourceKey: r.key,
    };
  });
}

/** The operator's standard controlling chart-of-accounts. */
export const OPERATOR_CHART_OF_ACCOUNTS: ReadonlyArray<GlAccount> =
  deriveChartOfAccounts();
