/**
 * Plan-execute split types.
 *
 * Pattern #1 from R-CODEGEN: Opus 4.7 plans (read-only), Sonnet 4.7 executes.
 * Cuts cost ~3× vs all-Opus while preserving planning quality and eliminating
 * premature destructive actions.
 */

/**
 * Read-only tools allowed during the Plan phase.
 * Note: NO Write, NO Edit, NO Delete, NO Bash-mutate. This is a type-level
 * guarantee — `ReadOnlyContext` simply does not have those members.
 */
export type ReadOnlyTool = 'Read' | 'Grep' | 'Glob' | 'BashReadOnly';

/**
 * Write tools allowed during the Execute phase, scoped to the worktree cwd
 * by `acceptEdits` and `allowedGlobs`.
 */
export type WriteTool = 'Read' | 'Grep' | 'Glob' | 'Bash' | 'Write' | 'Edit';

/**
 * The Plan phase context. Carries only read-only capabilities; the absence
 * of `write`, `edit`, `delete` properties is intentional and enforced at the
 * type level — calling them is a TS compile error, not a runtime hope.
 */
export interface ReadOnlyContext {
  readonly mode: 'plan';
  readonly model: 'claude-opus-4-7';
  readonly allowedTools: readonly ReadOnlyTool[];
  /** Async file-read primitive. */
  read(path: string): Promise<string>;
  /** Async grep — pattern + scope. */
  grep(pattern: string, scope?: string): Promise<readonly string[]>;
  /** Async glob — returns matching file paths. */
  glob(pattern: string): Promise<readonly string[]>;
  /** Read-only Bash: rejects any command not in the read-only allowlist. */
  bashReadOnly(command: string): Promise<string>;
}

export interface WriteContext {
  readonly mode: 'execute';
  readonly model: 'claude-sonnet-4-7';
  readonly cwd: string;
  readonly allowedGlobs: readonly string[];
  readonly allowedTools: readonly WriteTool[];
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  edit(path: string, oldString: string, newString: string): Promise<void>;
  bash(command: string): Promise<string>;
}

export interface PlanPhaseRequest {
  readonly task: string;
  readonly allowedGlobs: readonly string[];
  readonly repo: { readonly url: string; readonly baseBranch: string };
}

export interface EditableSpec {
  readonly summary: string;
  readonly riskTier: 'low' | 'medium' | 'high' | 'critical';
  readonly steps: readonly string[];
  readonly affectedPaths: readonly string[];
  readonly estimatedDiffLoc: number;
  readonly estimatedTokens: number;
  readonly requiredCodeOwners: readonly string[];
}

export interface ExecutionPhaseRequest {
  readonly spec: EditableSpec;
  readonly cwd: string;
  readonly allowedGlobs: readonly string[];
}

export interface ExecutionResult {
  readonly status: 'success' | 'partial' | 'failed';
  readonly modifiedFiles: readonly string[];
  readonly tokensUsed: number;
  readonly diffSummary: string;
  readonly failureReason?: string;
}

export interface ReflectionResult {
  readonly verdict: 'pass' | 'comments' | 'block';
  readonly findings: readonly ReflectionFinding[];
}

export interface ReflectionFinding {
  readonly critic: 'factual' | 'senior-eng' | 'security';
  readonly severity: 'info' | 'warning' | 'error' | 'critical';
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
}

export interface SelfCodegenTaskRequest {
  readonly task: string;
  readonly repo: { readonly url: string; readonly baseBranch: string };
  readonly allowedGlobs: readonly string[];
  /** Hard ceiling per task in USD cents (default = 100000 = $1000). */
  readonly budgetUsdCents?: number;
  readonly useDaytona?: boolean;
}

export interface SelfCodegenResult {
  readonly status: 'pr-opened' | 'blocked' | 'failed';
  readonly prUrl?: string;
  readonly plan?: EditableSpec;
  readonly execution?: ExecutionResult;
  readonly reflection?: ReflectionResult;
  readonly blockedReason?: string;
  readonly totalTokens: number;
  readonly totalCostCents: number;
}

/**
 * Thrown when the Plan phase tries to mutate state at runtime.
 * The type system already prevents this at compile time; this is the
 * belt-and-suspenders runtime check.
 */
export class PlanPhaseReadOnlyViolation extends Error {
  public readonly attemptedTool: string;
  public readonly attemptedPath?: string;

  public constructor(toolName: string, attemptedPath?: string) {
    super(
      `Plan phase is strictly read-only. Tool "${toolName}" is forbidden` +
        (attemptedPath ? ` (attempted on "${attemptedPath}")` : '') +
        '. Use the Execute phase for writes.',
    );
    this.name = 'PlanPhaseReadOnlyViolation';
    this.attemptedTool = toolName;
    if (attemptedPath !== undefined) {
      this.attemptedPath = attemptedPath;
    }
  }
}
