/**
 * @borjie/operator-pack — the operator/business pack manifest.
 *
 * What the platform operator (Borjie-the-company) loads over the Mr-Mwikila
 * cortex to run ITSELF. UNIVERSAL: ships with the cortex, always-loaded, NOT a
 * per-customer vertical pin — every vertical's operator inherits it. Customer
 * verticals (mining-tz, …) relabel the SAME @borjie/business-ontology for their
 * CUSTOMERS; this pack is the operator's own ERP world + homeostatic drives.
 */

import type { DomainOntology } from '@borjie/business-ontology';
import { operatorBusinessOntology } from './ontology.js';

export { operatorBusinessOntology } from './ontology.js';

/**
 * A homeostatic drive — a standing concern the operator's business MD keeps in
 * balance (the business analogue of the mining cash-runway/licence-currency
 * drives; the cortex's motivation-engine accepts injected drives).
 */
export interface OperatorDrive {
  readonly key: string;
  readonly label: string;
  /** The ontology resource the drive monitors. */
  readonly watches: string;
  /** Plain-language homeostatic concern. */
  readonly concern: string;
}

export const OPERATOR_DRIVES: ReadonlyArray<OperatorDrive> = [
  { key: 'cash_runway', label: 'Cash runway', watches: 'cash', concern: 'Never run out of cash; keep months of runway ahead.' },
  { key: 'ar_collection', label: 'AR collection', watches: 'accounts_receivable', concern: 'Collect receivables before they age; keep days-sales-outstanding low.' },
  { key: 'payroll_on_time', label: 'Payroll on time', watches: 'payroll_liability', concern: 'Pay every employee in full, on time, every cycle.' },
  { key: 'margin', label: 'Operating margin', watches: 'operating_expense', concern: 'Keep revenue ahead of expense; protect the operating margin.' },
  { key: 'retention', label: 'Customer retention', watches: 'subscription_revenue', concern: 'Renew customers; arrest churn before it shows up in MRR.' },
  { key: 'compliance_currency', label: 'Compliance currency', watches: 'accounts_payable', concern: 'File every return and settle every obligation before its deadline.' },
];

/** The operator/business pack manifest. */
export interface OperatorPackManifest {
  readonly packId: string;
  readonly displayName: string;
  /** ALWAYS-loaded: ships with the cortex, never a per-customer vertical pin. */
  readonly universal: true;
  readonly ontology: DomainOntology;
  readonly drives: ReadonlyArray<OperatorDrive>;
}

export const operatorPack: OperatorPackManifest = {
  packId: 'operator-business',
  displayName: 'Borjie Operator — Business / ERP',
  universal: true,
  ontology: operatorBusinessOntology,
  drives: OPERATOR_DRIVES,
};
