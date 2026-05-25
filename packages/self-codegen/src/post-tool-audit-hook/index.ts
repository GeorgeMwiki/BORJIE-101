/**
 * Module 8 — post-tool-audit-hook
 * Async forensic trail → sovereign ledger AND Slack on Write/Edit/Delete.
 */

export * from './types.js';
export {
  createAuditHook,
  buildEntry,
  isAuditedTool,
  MockSlackSink,
  MockSovereignLedgerSink,
  type CreateAuditHookArgs,
  type PostToolUseHook,
} from './create-audit-hook.js';
