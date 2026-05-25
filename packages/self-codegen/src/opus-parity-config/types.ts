/**
 * Opus-parity config types.
 *
 * Pattern #10 from R-CODEGEN. Default task_budget = 100000 USD cents
 * ($1000 hard ceiling). Adaptive thinking ON for plan; interleaved ON for
 * tool-use. Pairs with M-C max-tool-use package.
 *
 * HARD NEVERS (enforced at the type level):
 *   - `permission_mode` MAY NOT be 'bypassPermissions' (Cursor-deletes-DB
 *      incident April 2026). This is enforced by literal union exclusion.
 */

export type SafePermissionMode =
  | 'plan'
  | 'default'
  | 'dontAsk'
  | 'acceptEdits';

export type ModelId = 'claude-opus-4-7' | 'claude-sonnet-4-7' | 'claude-haiku-4-7';

export interface OpusParityConfig {
  readonly model: ModelId;
  readonly permissionMode: SafePermissionMode;
  readonly taskBudgetCents: number;
  readonly adaptiveThinking: boolean;
  readonly interleavedThinking: boolean;
  readonly extendedThinkingEffort: 'low' | 'medium' | 'high' | 'xhigh';
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
}

export const DEFAULT_TASK_BUDGET_CENTS = 100_000; // = $1000 hard ceiling

/**
 * Plan-phase preset: Opus 4.7, plan mode, read-only, adaptive thinking on.
 */
export const PLAN_PHASE_CONFIG: OpusParityConfig = Object.freeze({
  model: 'claude-opus-4-7',
  permissionMode: 'plan',
  taskBudgetCents: DEFAULT_TASK_BUDGET_CENTS,
  adaptiveThinking: true,
  interleavedThinking: false,
  extendedThinkingEffort: 'high',
  allowedTools: Object.freeze(['Read', 'Grep', 'Glob', 'BashReadOnly']),
  disallowedTools: Object.freeze([
    'Write',
    'Edit',
    'Delete',
    'MultiEdit',
    'NotebookEdit',
    'Bash',
  ]),
});

/**
 * Execute-phase preset: Sonnet 4.7, acceptEdits in worktree, interleaved
 * thinking on for tool-use.
 */
export const EXECUTE_PHASE_CONFIG: OpusParityConfig = Object.freeze({
  model: 'claude-sonnet-4-7',
  permissionMode: 'acceptEdits',
  taskBudgetCents: DEFAULT_TASK_BUDGET_CENTS,
  adaptiveThinking: true,
  interleavedThinking: true,
  extendedThinkingEffort: 'medium',
  allowedTools: Object.freeze(['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit']),
  disallowedTools: Object.freeze(['Delete']),
});

/**
 * Ultrareview preset: Opus 4.7 xhigh — reserved for CODEOWNER-only globs.
 */
export const ULTRAREVIEW_CONFIG: OpusParityConfig = Object.freeze({
  model: 'claude-opus-4-7',
  permissionMode: 'plan',
  taskBudgetCents: DEFAULT_TASK_BUDGET_CENTS,
  adaptiveThinking: true,
  interleavedThinking: false,
  extendedThinkingEffort: 'xhigh',
  allowedTools: Object.freeze(['Read', 'Grep', 'Glob', 'BashReadOnly']),
  disallowedTools: Object.freeze(['Write', 'Edit', 'Delete']),
});
