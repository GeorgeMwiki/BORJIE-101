/**
 * Admin skill bundle — write operations reachable from the Mr. Mwikila chat
 * widget. Each tool:
 *   - validates input with Zod,
 *   - enforces tenant isolation,
 *   - routes high-risk actions through a PROPOSED_ACTION gate,
 *   - commits side-effects only after the user's explicit confirmation.
 *
 * Register via `registerDefaultSkills(dispatcher)`.
 */

import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { createCaseTool } from './create-case.js';
import { assignWorkOrderCommitTool } from './assign-work-order.js';
import { approveOfftakeRenewalTool } from './approve-lease-renewal.js';
import { approveTenderBidTool } from './approve-tender-bid.js';
import { reissueLetterTool } from './reissue-letter.js';
import { assignTrainingTool } from './assign-training.js';
import { acknowledgeExceptionTool } from './acknowledge-exception.js';
import { updateAutonomyPolicyTool } from './update-autonomy-policy.js';

export * from './shared.js';
export * from './create-case.js';
export * from './assign-work-order.js';
export * from './approve-lease-renewal.js';
export * from './approve-tender-bid.js';
export * from './reissue-letter.js';
export * from './assign-training.js';
export * from './acknowledge-exception.js';
export * from './update-autonomy-policy.js';

export const ADMIN_SKILL_TOOLS: readonly ToolHandler[] = [
  createCaseTool,
  assignWorkOrderCommitTool,
  approveOfftakeRenewalTool,
  approveTenderBidTool,
  reissueLetterTool,
  assignTrainingTool,
  acknowledgeExceptionTool,
  updateAutonomyPolicyTool,
];
