/**
 * Region-specific skills: M-Pesa reconciliation, TRA royalty-return summary,
 * cooperative-levy reconciliation, and Swahili/Sheng draft templates.
 */

export * from './mpesa-reconcile.js';
export * from './tra-royalty-summary.js';
export * from './service-charge-reconcile.js';
export * from './swahili-draft.js';

import { mpesaReconcileTool } from './mpesa-reconcile.js';
import { traRoyaltySummaryTool } from './tra-royalty-summary.js';
import { serviceChargeReconcileTool } from './service-charge-reconcile.js';
import { swahiliDraftTool } from './swahili-draft.js';

/**
 * All region skills exported as a ready-to-register tool bundle.
 */
export const KENYA_SKILL_TOOLS = [
  mpesaReconcileTool,
  traRoyaltySummaryTool,
  serviceChargeReconcileTool,
  swahiliDraftTool,
];
