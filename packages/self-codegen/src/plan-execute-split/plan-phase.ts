/**
 * Phase 1 — PLAN (Opus 4.7, read-only).
 *
 * The plan phase produces an editable spec but performs ZERO file mutation.
 * Read-only is enforced at the type level (the `ReadOnlyContext` interface
 * has no write/edit/delete) AND at runtime (a guard throws on illegal use).
 */

import {
  PlanPhaseReadOnlyViolation,
  type EditableSpec,
  type PlanPhaseRequest,
  type ReadOnlyContext,
  type ReadOnlyTool,
} from './types.js';

const ALLOWED_READ_ONLY_TOOLS: readonly ReadOnlyTool[] = [
  'Read',
  'Grep',
  'Glob',
  'BashReadOnly',
];

const FORBIDDEN_TOOLS = new Set([
  'Write',
  'Edit',
  'Delete',
  'Bash',
  'NotebookEdit',
  'MultiEdit',
]);

const MUTATING_BASH_PATTERNS: readonly RegExp[] = [
  /\brm\b/,
  /\bmv\b/,
  /\bcp\b\s+-/,
  /\bgit\s+(commit|push|reset|checkout\s+--|clean)/,
  /\bnpm\s+(install|uninstall|publish)/,
  /\bpnpm\s+(add|remove|publish)/,
  />>?[^>]/,
  /\bsed\s+-i/,
  /\bchmod\b/,
];

export function isReadOnlyBashCommand(cmd: string): boolean {
  return !MUTATING_BASH_PATTERNS.some((re) => re.test(cmd));
}

/**
 * Returns a read-only context bound to a backing executor.
 *
 * The returned object's TYPE has no write/edit/delete members. The runtime
 * also throws `PlanPhaseReadOnlyViolation` if any mutating Bash command is
 * passed to `bashReadOnly`.
 */
export function createReadOnlyContext(executor: {
  read: (path: string) => Promise<string>;
  grep: (pattern: string, scope?: string) => Promise<readonly string[]>;
  glob: (pattern: string) => Promise<readonly string[]>;
  bash: (cmd: string) => Promise<string>;
}): ReadOnlyContext {
  return Object.freeze({
    mode: 'plan' as const,
    model: 'claude-opus-4-7' as const,
    allowedTools: ALLOWED_READ_ONLY_TOOLS,
    read: (path: string): Promise<string> => executor.read(path),
    grep: (pattern: string, scope?: string): Promise<readonly string[]> =>
      executor.grep(pattern, scope),
    glob: (pattern: string): Promise<readonly string[]> => executor.glob(pattern),
    bashReadOnly: async (command: string): Promise<string> => {
      if (!isReadOnlyBashCommand(command)) {
        throw new PlanPhaseReadOnlyViolation('Bash', command);
      }
      return executor.bash(command);
    },
  });
}

/**
 * Runtime guard for any tool-name that might reach the plan phase.
 * Throws on Write|Edit|Delete|raw-Bash or any other mutating tool.
 */
export function assertPlanPhaseToolAllowed(toolName: string, path?: string): void {
  if (FORBIDDEN_TOOLS.has(toolName)) {
    throw new PlanPhaseReadOnlyViolation(toolName, path);
  }
}

export type PlanPhaseFn = (
  request: PlanPhaseRequest,
  ctx: ReadOnlyContext,
) => Promise<EditableSpec>;

/**
 * Default plan phase implementation. Wraps the user-supplied planner so we
 * can enforce read-only at the boundary. The planner closes over `ctx`
 * which has no mutation surface.
 */
export async function runPlanPhase(
  request: PlanPhaseRequest,
  ctx: ReadOnlyContext,
  planner: (req: PlanPhaseRequest, c: ReadOnlyContext) => Promise<EditableSpec>,
): Promise<EditableSpec> {
  // Defensive: planners that try to widen ctx fail here.
  if (ctx.mode !== 'plan') {
    throw new PlanPhaseReadOnlyViolation('non-plan-context');
  }
  const spec = await planner(request, ctx);
  if (!spec || typeof spec.summary !== 'string') {
    throw new Error('Planner returned an invalid spec (missing summary).');
  }
  return Object.freeze({ ...spec });
}
