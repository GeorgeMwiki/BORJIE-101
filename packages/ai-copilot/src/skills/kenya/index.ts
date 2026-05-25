/**
 * Kenya-specific skills: M-Pesa reconciliation, KRA MRI summary, service
 * charge reconciliation, and Swahili/Sheng draft templates.
 */

export * from './mpesa-reconcile.js';
export * from './kra-rental-summary.js';
export * from './service-charge-reconcile.js';
export * from './swahili-draft.js';

import { mpesaReconcileTool } from './mpesa-reconcile.js';
import { kraRentalSummaryTool } from './kra-rental-summary.js';
import { serviceChargeReconcileTool } from './service-charge-reconcile.js';
import { swahiliDraftTool } from './swahili-draft.js';

/**
 * All Kenya skills exported as a ready-to-register tool bundle.
 */
export const KENYA_SKILL_TOOLS = [
  mpesaReconcileTool,
  kraRentalSummaryTool,
  serviceChargeReconcileTool,
  swahiliDraftTool,
];
