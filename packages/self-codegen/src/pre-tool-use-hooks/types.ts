/**
 * PreToolUse hook types.
 *
 * Pattern #4 from R-CODEGEN: deny destructive globs via `canUseTool` /
 * PreToolUse hooks. `deny` wins everywhere — even in `bypassPermissions`.
 */

export type PreToolUseDecision =
  | { kind: 'allow' }
  | {
      kind: 'deny';
      code: 'destructive-glob' | 'requires-approval' | 'unknown-tool';
      reason: string;
    }
  | { kind: 'ask'; reason: string };

export interface PreToolUseInput {
  readonly toolName: string;
  readonly toolInput: { readonly file_path?: string; readonly command?: string };
  readonly sessionId?: string;
  readonly tenantId?: string;
}

export type PreToolUseHook = (input: PreToolUseInput) => Promise<PreToolUseDecision>;

export interface SelfCodegenHookConfig {
  /** Glob patterns that the hook denies for Write/Edit/Delete tools. */
  readonly denyGlobs?: readonly string[];
  /** Globs that require dual-human approval (returned as `ask`). */
  readonly requireApproval?: readonly string[];
  /** Tools that the hook inspects (default: Write|Edit|Delete|MultiEdit|NotebookEdit). */
  readonly inspectedTools?: readonly string[];
}

export const DEFAULT_DENY_GLOBS: readonly string[] = [
  '**/migrations/**',
  '**/m-pesa/**',
  '.claude/**',
  '.github/workflows/**',
  '**/*.env*',
  '**/secrets/**',
];

export const DEFAULT_INSPECTED_TOOLS: readonly string[] = [
  'Write',
  'Edit',
  'Delete',
  'MultiEdit',
  'NotebookEdit',
];
