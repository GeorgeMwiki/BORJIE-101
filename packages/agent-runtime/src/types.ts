/**
 * @borjie/agent-runtime — shared types.
 *
 * Every type is `readonly` so handlers compose without aliasing
 * bugs. The shapes track the 2026 Claude Agent SDK contract:
 *
 *  - 7 hook events: PreToolUse, PostToolUse, Stop, UserPromptSubmit,
 *    SessionStart, Notification, PreCompact
 *  - PreToolUse `permissionDecision`: allow | deny | ask
 *  - Sub-agent frontmatter: description (required), tools?, model?
 *  - Skill frontmatter: name + description; rest free-form
 *  - MCP transport: stdio | sse | streamable-http (SSE deprecated 2025)
 *  - Permission modes: strict (default-deny), open (default-allow),
 *    audit-only (always allow, log)
 */

// ─────────────────────────────────────────────────────────────────
// Hook events
// ─────────────────────────────────────────────────────────────────

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'Notification'
  | 'PreCompact';

export interface HookContext {
  readonly event: HookEvent;
  readonly toolName?: string;
  readonly toolInput?: Readonly<Record<string, unknown>>;
  readonly toolResponse?: unknown;
  readonly prompt?: string;
  readonly sessionId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Per the Claude Agent SDK spec (2026) PreToolUse hooks can return:
 *
 *   - permissionDecision: 'allow' | 'deny' | 'ask'  → gate the call
 *   - updatedInput: object                          → MUTATE tool args
 *   - additionalContext: string                     → inject into prompt
 *
 * PostToolUse hooks can only return `additionalContext`. UserPromptSubmit
 * can `updatedInput` (the prompt). All other events are side-effect only.
 */
export interface HookSpecificOutput {
  readonly hookEventName: HookEvent;
  readonly permissionDecision?: 'allow' | 'deny' | 'ask';
  readonly permissionDecisionReason?: string;
  readonly updatedInput?: Readonly<Record<string, unknown>>;
  readonly additionalContext?: string;
}

export interface HookOutput {
  readonly hookSpecificOutput?: HookSpecificOutput;
  /** Free-form log line — written via the runtime's logger sink. */
  readonly log?: string;
}

export type HookHandler = (
  ctx: HookContext,
) => HookOutput | Promise<HookOutput> | void | Promise<void>;

export interface Hook {
  readonly id: string;
  readonly event: HookEvent;
  /** RegExp source string matched against `toolName`; `'*'` matches all. */
  readonly matcher?: string;
  readonly handler: HookHandler;
}

export interface HookResult {
  /** Final decision after composing every matching hook. */
  readonly decision: 'allow' | 'deny' | 'ask';
  readonly reason?: string;
  /** If any PreToolUse hook supplied `updatedInput`, last-write-wins. */
  readonly updatedInput?: Readonly<Record<string, unknown>>;
  /** Accumulated `additionalContext` from every matching hook. */
  readonly additionalContext: ReadonlyArray<string>;
  /** Accumulated free-form log lines (for observability sinks). */
  readonly logs: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────
// Slash commands
// ─────────────────────────────────────────────────────────────────

export interface SlashCommand {
  readonly name: string;
  readonly description?: string;
  readonly argumentHint?: string;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly model?: string;
  /** Prompt template — `$ARGUMENTS` is replaced with user input. */
  readonly prompt: string;
  /** Absolute path the command was loaded from (for debugging). */
  readonly source: string;
}

export interface SlashCommandInvocation {
  readonly name: string;
  readonly args: string;
  readonly resolvedPrompt: string;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly model?: string;
}

// ─────────────────────────────────────────────────────────────────
// Sub-agents
// ─────────────────────────────────────────────────────────────────

export interface SubAgent {
  readonly name: string;
  readonly description: string;
  /** Allowlist; if omitted the sub-agent inherits all tools. */
  readonly tools?: ReadonlyArray<string>;
  /** Denylist subtracted from whatever the agent would otherwise have. */
  readonly disallowedTools?: ReadonlyArray<string>;
  readonly model?: string;
  readonly systemPrompt: string;
  readonly source: string;
}

export interface SubAgentInvocation {
  readonly agentName: string;
  readonly prompt: string;
  readonly resolvedTools: ReadonlyArray<string>;
  readonly model?: string;
  readonly response: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Skills (Anthropic SKILL.md format)
// ─────────────────────────────────────────────────────────────────

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly allowedTools?: ReadonlyArray<string>;
  /** If true, only invoked programmatically, never by the model. */
  readonly disableModelInvocation?: boolean;
  /** Optional structured metadata from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** SKILL.md body — the procedure the agent follows on invoke. */
  readonly body: string;
  readonly source: string;
  /** Optional code invoker — non-null when a sibling `.ts` is registered. */
  readonly invoke?: SkillInvoker;
}

export type SkillInvoker = (args: {
  readonly input: Readonly<Record<string, unknown>>;
  readonly skill: Skill;
}) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────
// MCP servers
// ─────────────────────────────────────────────────────────────────

export type MCPTransport = 'stdio' | 'sse' | 'streamable-http';

export interface MCPServerConfig {
  readonly name: string;
  readonly transport: MCPTransport;
  /** Required for stdio; ignored for SSE / streamable-http. */
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  /** Required for SSE / streamable-http; ignored for stdio. */
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Initialise timeout (ms). Default 10 000. */
  readonly initTimeoutMs?: number;
}

export interface MCPTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

export interface MCPToolResult {
  readonly ok: boolean;
  readonly content: ReadonlyArray<MCPToolContent>;
  readonly errorMessage?: string;
}

export interface MCPToolContent {
  readonly type: 'text' | 'image' | 'resource';
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

// ─────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  readonly name: string;
  readonly type: 'preference' | 'fact' | 'guidance' | 'project' | 'workflow';
  readonly content: string;
  readonly tags?: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly source?: string;
}

export interface MemoryIndex {
  readonly entries: ReadonlyArray<MemoryEntry>;
  readonly indexPath: string;
}

// ─────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────

export type PermissionMode = 'strict' | 'open' | 'audit-only';

export type PermissionDecision = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  /** Tool name OR `Tool(arg-pattern)` (Claude Code style). */
  readonly rule: string;
  readonly source: 'project' | 'user' | 'enterprise' | 'runtime';
}

export interface PermissionConfig {
  readonly mode: PermissionMode;
  readonly allow: ReadonlyArray<PermissionRule>;
  readonly deny: ReadonlyArray<PermissionRule>;
  readonly ask?: ReadonlyArray<PermissionRule>;
}

export interface PermissionCheck {
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface PermissionAuditEntry {
  readonly timestamp: string;
  readonly tool: string;
  readonly decision: PermissionDecision;
  readonly mode: PermissionMode;
  readonly matchedRule?: string;
}

// ─────────────────────────────────────────────────────────────────
// Agent session + worktree
// ─────────────────────────────────────────────────────────────────

export interface AgentSession {
  readonly id: string;
  readonly startedAt: string;
  readonly projectPath: string;
  readonly worktreePath?: string;
  readonly cwd: string;
  readonly model?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly createdAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Brain port — the only LLM contract this runtime knows about
// ─────────────────────────────────────────────────────────────────

/**
 * Sub-agents and slash commands need to actually call a model. The
 * runtime doesn't pick an LLM — callers inject a `BrainPort`. This
 * is the same shape `packages/central-intelligence/kernel/router`
 * already exposes, so wiring is `runtime = createAgentRuntime({
 * brain: kernel.router })`.
 */
export interface BrainCallArgs {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly allowedTools?: ReadonlyArray<string>;
  readonly model?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface BrainCallResult {
  readonly text: string;
  readonly toolCalls?: ReadonlyArray<unknown>;
  readonly modelUsed?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface BrainPort {
  call(args: BrainCallArgs): Promise<BrainCallResult>;
}

// ─────────────────────────────────────────────────────────────────
// Logger sink — observability hand-off
// ─────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogger {
  log(level: LogLevel, message: string, ctx?: Readonly<Record<string, unknown>>): void;
}

export const noopLogger: RuntimeLogger = Object.freeze({ log: () => {} });
