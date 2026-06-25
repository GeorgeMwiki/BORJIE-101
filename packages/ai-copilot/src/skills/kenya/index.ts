/**
 * Region-specific skills: M-Pesa reconciliation and TRA royalty-return summary.
 */

export * from './mpesa-reconcile.js';
export * from './tra-royalty-summary.js';

import { mpesaReconcileTool } from './mpesa-reconcile.js';
import { traRoyaltySummaryTool } from './tra-royalty-summary.js';

/**
 * All region skills exported as a ready-to-register tool bundle.
 */
export const KENYA_SKILL_TOOLS = [
  mpesaReconcileTool,
  traRoyaltySummaryTool,
];
