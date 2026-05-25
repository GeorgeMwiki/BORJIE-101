/**
 * @borjie/open-coding-agent-patterns — shared types.
 *
 * Port of patterns from the leading 2026 open-source coding agents:
 *
 *   - Aider 0.65+    — diff-based editing, repository map, TDD loop
 *   - Cursor 1.x     — composer + agent mode + codebase indexing
 *   - Cline 3.x      — extensive tool use + plan/act modes
 *   - OpenHands 0.20 — sandboxed exec + browser tool + terminal
 *   - SWE-agent 0.7  — agent-computer interface trajectory replay
 *   - Plandex        — multi-step plan with checkpoints
 *   - Browser-use    — DOM-first browser automation
 *   - Anthropic CUA  — pixel-level computer-use grounding
 *
 * Every shape is `readonly` to keep the patterns composable
 * without aliasing bugs. Brain + sandbox + browser + computer
 * are surfaced as ports so the same patterns work against any
 * model and any execution environment.
 */

// ─────────────────────────────────────────────────────────────────
// Logging — shared sink (mirrors agent-runtime)
// ─────────────────────────────────────────────────────────────────

export interface RuntimeLogger {
  readonly debug: (msg: string, meta?: Record<string, unknown>) => void;
  readonly info: (msg: string, meta?: Record<string, unknown>) => void;
  readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
  readonly error: (msg: string, meta?: Record<string, unknown>) => void;
}

export const noopLogger: RuntimeLogger = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

// ─────────────────────────────────────────────────────────────────
// Brain port — model interface (port to your concrete brain)
// ─────────────────────────────────────────────────────────────────

export interface BrainRequest {
  readonly system?: string;
  readonly prompt: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface BrainResponse {
  readonly text: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface BrainPort {
  readonly generate: (req: BrainRequest) => Promise<BrainResponse>;
}

// ─────────────────────────────────────────────────────────────────
// Codebase snapshot + repository map (Aider-style)
// ─────────────────────────────────────────────────────────────────

export interface CodebaseFile {
  readonly path: string;
  /** Bytes — used by ranking heuristic. */
  readonly size: number;
  /** Last modified mtime (epoch ms) — used by recency heuristic. */
  readonly mtimeMs: number;
  /** Content hash so cache invalidation is content-addressed. */
  readonly contentHash: string;
  /** Detected programming language (lowercased extension or 'unknown'). */
  readonly language: string;
}

export interface CodebaseSnapshot {
  readonly rootDir: string;
  readonly files: ReadonlyArray<CodebaseFile>;
  readonly takenAt: number;
}

export interface RepositorySymbol {
  readonly name: string;
  readonly kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'export';
  readonly line: number;
  readonly docstring?: string;
}

export interface RepositoryFileMap {
  readonly path: string;
  readonly language: string;
  readonly symbols: ReadonlyArray<RepositorySymbol>;
  /** Brief docstring extracted from top of file. */
  readonly summary?: string;
  /** Number of intra-repo imports referencing this file. */
  readonly importCount: number;
  /** Estimated token cost of the map entry (rough heuristic: chars/4). */
  readonly tokenEstimate: number;
}

export interface RepositoryMap {
  readonly rootDir: string;
  readonly files: ReadonlyArray<RepositoryFileMap>;
  readonly tokenEstimate: number;
  readonly tokenBudget: number;
  /** Files dropped because they overran the token budget. */
  readonly droppedFiles: ReadonlyArray<string>;
  /** Content-addressed cache key for reuse across calls. */
  readonly cacheKey: string;
}

// ─────────────────────────────────────────────────────────────────
// Edit proposal (Aider/Cline-style minimal-diff editing)
// ─────────────────────────────────────────────────────────────────

export type DiffDialect = 'unified' | 'search-replace' | 'ast-aware';

export interface SearchReplaceBlock {
  readonly search: string;
  readonly replace: string;
}

export interface MinimalDiff {
  readonly dialect: DiffDialect;
  /** Used when dialect is 'unified'. */
  readonly unifiedDiff?: string;
  /** Used when dialect is 'search-replace' (Aider's preferred format). */
  readonly searchReplaceBlocks?: ReadonlyArray<SearchReplaceBlock>;
  /** Used when dialect is 'ast-aware' — JSON-encoded tree mutation list. */
  readonly astMutations?: string;
}

export interface EditProposal {
  readonly filePath: string;
  readonly intent: string;
  readonly diff: MinimalDiff;
  /** Brain rationale (1-2 sentences) — surfaced for review. */
  readonly rationale?: string;
}

export interface EditApplyConflict {
  readonly kind: 'search-not-found' | 'ambiguous' | 'patch-rejected' | 'binary-file';
  readonly detail: string;
}

export interface EditApplyResult {
  readonly newBytes: string;
  readonly conflicts: ReadonlyArray<EditApplyConflict>;
  readonly appliedHunks: number;
}

export interface SideEffectReport {
  /** Lines touched outside the expected intent — heuristic. */
  readonly unexpectedLineChanges: number;
  /** Files touched outside the proposed filePath set. */
  readonly unexpectedFilesTouched: ReadonlyArray<string>;
  /** True if the diff appears to confine itself to the stated intent. */
  readonly isFocused: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Sandbox execution (OpenHands-style)
// ─────────────────────────────────────────────────────────────────

export interface SandboxCommand {
  readonly cmd: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Hard cap on captured stdout/stderr bytes. */
  readonly outputCapBytes?: number;
}

export interface SandboxExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export interface SandboxExecution {
  readonly command: SandboxCommand;
  readonly result: SandboxExecutionResult;
  readonly sandboxKind: 'docker' | 'e2b' | 'local-subprocess';
}

export interface SandboxPort {
  readonly kind: 'docker' | 'e2b' | 'local-subprocess';
  readonly exec: (command: SandboxCommand) => Promise<SandboxExecutionResult>;
  readonly close?: () => Promise<void>;
}

export interface TestResult {
  readonly passed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly testRunner: 'pnpm' | 'pytest' | 'cargo' | 'go' | 'custom';
}

// ─────────────────────────────────────────────────────────────────
// TDD loop (Aider's red→green→refactor loop)
// ─────────────────────────────────────────────────────────────────

export type TDDPhase = 'write-test' | 'expect-fail' | 'write-code' | 'expect-pass' | 'refactor';

export interface TDDStep {
  readonly iteration: number;
  readonly phase: TDDPhase;
  readonly brainResponseText?: string;
  readonly editProposal?: EditProposal;
  readonly testResult?: TestResult;
  readonly notes?: string;
}

export interface TDDLoopResult {
  readonly final: 'green' | 'red' | 'max-iterations';
  readonly iterations: number;
  readonly history: ReadonlyArray<TDDStep>;
}

export interface TDDLoop {
  readonly intent: string;
  readonly testFilePath: string;
  readonly implFilePath: string;
  readonly result: TDDLoopResult;
}

// ─────────────────────────────────────────────────────────────────
// Plan persistence (Plandex-style multi-step plan)
// ─────────────────────────────────────────────────────────────────

export type PlanStepStatus = 'pending' | 'in-progress' | 'done' | 'skipped' | 'failed';

export interface PlanStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly expectedOutput: string;
  readonly status: PlanStepStatus;
  readonly checkpoint?: PlanCheckpoint;
}

export interface PlanCheckpoint {
  readonly stepId: string;
  readonly completedAt: number;
  readonly artifacts: ReadonlyArray<string>;
  readonly notes?: string;
}

export interface Plan {
  readonly id: string;
  readonly goal: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly steps: ReadonlyArray<PlanStep>;
  readonly version: number;
}

// ─────────────────────────────────────────────────────────────────
// Browser + computer action ports (Browser-use, Anthropic CUA)
// ─────────────────────────────────────────────────────────────────

export type BrowserActionKind = 'goto' | 'click' | 'type' | 'screenshot' | 'read' | 'wait';

export interface BrowserAction {
  readonly kind: BrowserActionKind;
  readonly url?: string;
  readonly selector?: string;
  readonly text?: string;
  readonly waitMs?: number;
  readonly capturedAt: number;
}

export interface BrowserActionResult {
  readonly success: boolean;
  readonly screenshotPath?: string;
  readonly extractedText?: string;
  readonly error?: string;
}

export interface BrowserPort {
  readonly goto: (url: string) => Promise<BrowserActionResult>;
  readonly click: (selector: string) => Promise<BrowserActionResult>;
  readonly type: (selector: string, text: string) => Promise<BrowserActionResult>;
  readonly screenshot: () => Promise<BrowserActionResult>;
  readonly read: () => Promise<BrowserActionResult>;
  readonly close?: () => Promise<void>;
}

export type ComputerActionKind = 'key' | 'mouseClick' | 'mouseMove' | 'screenshot' | 'type';

export interface ComputerAction {
  readonly kind: ComputerActionKind;
  readonly keys?: ReadonlyArray<string>;
  readonly x?: number;
  readonly y?: number;
  readonly text?: string;
  readonly capturedAt: number;
}

export interface ComputerActionResult {
  readonly success: boolean;
  readonly screenshotPath?: string;
  readonly error?: string;
}

export interface ComputerActionPort {
  readonly key: (keys: ReadonlyArray<string>) => Promise<ComputerActionResult>;
  readonly mouseClick: (x: number, y: number) => Promise<ComputerActionResult>;
  readonly screenshot: () => Promise<ComputerActionResult>;
  readonly type: (text: string) => Promise<ComputerActionResult>;
}

// ─────────────────────────────────────────────────────────────────
// Trajectory record/replay (SWE-agent / Cline parity)
// ─────────────────────────────────────────────────────────────────

export type TrajectoryEventKind =
  | 'brain-call'
  | 'sandbox-exec'
  | 'edit-applied'
  | 'browser-action'
  | 'computer-action'
  | 'plan-step';

export interface TrajectoryEvent {
  readonly seq: number;
  readonly at: number;
  readonly kind: TrajectoryEventKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentTrajectory {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly events: ReadonlyArray<TrajectoryEvent>;
}

export interface VerificationReport {
  readonly matches: number;
  readonly mismatches: number;
  readonly missing: number;
  readonly extra: number;
  readonly diff: ReadonlyArray<{
    readonly seq: number;
    readonly reason: string;
  }>;
}
