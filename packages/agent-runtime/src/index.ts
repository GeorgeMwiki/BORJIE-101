/**
 * @borjie/agent-runtime — public API.
 *
 * Wire-up:
 *
 *   import { createAgentRuntime } from '@borjie/agent-runtime';
 *
 *   const runtime = await createAgentRuntime({
 *     projectPath: process.cwd(),
 *     brain: kernel.router,           // optional — for /command + sub-agent
 *     permissions: { mode: 'strict' },// optional — defaults to strict
 *   });
 */

import { HookEngine } from './hooks/index.js';
import { SlashCommandLoader } from './slash-commands/index.js';
import { SubAgentLoader } from './sub-agents/index.js';
import { SkillsRegistry } from './skills/index.js';
import { MCPHost } from './mcp/index.js';
import { MemoryStore } from './memory/index.js';
import { PermissionEngine } from './permissions/index.js';
import type {
  AgentSession,
  BrainPort,
  PermissionMode,
  RuntimeLogger,
} from './types.js';

export type {
  AgentSession,
  BrainCallArgs,
  BrainCallResult,
  BrainPort,
  Hook,
  HookContext,
  HookEvent,
  HookHandler,
  HookOutput,
  HookResult,
  HookSpecificOutput,
  LogLevel,
  MCPServerConfig,
  MCPTool,
  MCPToolContent,
  MCPToolResult,
  MCPTransport,
  MemoryEntry,
  MemoryIndex,
  PermissionAuditEntry,
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionMode,
  PermissionRule,
  RuntimeLogger,
  SkillInvoker,
  Skill,
  SlashCommand,
  SlashCommandInvocation,
  SubAgent,
  SubAgentInvocation,
  Worktree,
} from './types.js';
export { noopLogger } from './types.js';

export { HookEngine, isHookEvent } from './hooks/index.js';
export { SlashCommandLoader, substituteArguments } from './slash-commands/index.js';
export { SubAgentLoader, resolveTools } from './sub-agents/index.js';
export { SkillsRegistry } from './skills/index.js';
export { MCPHost, normaliseMCPConfig } from './mcp/index.js';
export { MemoryStore, getMemoryDir, encodeProjectPath } from './memory/index.js';
export { PermissionEngine, matchesRule, globToRegExp } from './permissions/index.js';
export { parseFrontmatter, asStringList } from './frontmatter.js';

export interface AgentRuntimeOptions {
  readonly projectPath: string;
  readonly userScopePath?: string;
  readonly enterpriseScopePath?: string;
  readonly memoryRoot?: string;
  readonly brain?: BrainPort;
  readonly logger?: RuntimeLogger;
  readonly permissions?: {
    readonly mode?: PermissionMode;
    readonly autoLoad?: boolean;
  };
}

export interface AgentRuntime {
  readonly session: AgentSession;
  readonly hooks: HookEngine;
  readonly slashCommands: SlashCommandLoader;
  readonly subAgents: SubAgentLoader;
  readonly skills: SkillsRegistry;
  readonly mcp: MCPHost;
  readonly memory: MemoryStore;
  readonly permissions: PermissionEngine;
  readonly brain: BrainPort | undefined;
  shutdown(): Promise<void>;
}

export async function createAgentRuntime(
  opts: AgentRuntimeOptions,
): Promise<AgentRuntime> {
  const logger = opts.logger;
  const hooks = new HookEngine({
    projectPath: opts.projectPath,
    ...(logger !== undefined ? { logger } : {}),
  });
  const slashCommands = new SlashCommandLoader({
    projectPath: opts.projectPath,
    ...(opts.userScopePath !== undefined ? { userScopePath: opts.userScopePath } : {}),
    ...(logger !== undefined ? { logger } : {}),
  });
  const subAgents = new SubAgentLoader({
    projectPath: opts.projectPath,
    ...(opts.userScopePath !== undefined ? { userScopePath: opts.userScopePath } : {}),
    ...(logger !== undefined ? { logger } : {}),
  });
  const skills = new SkillsRegistry({
    projectPath: opts.projectPath,
    ...(logger !== undefined ? { logger } : {}),
  });
  const mcp = new MCPHost({
    projectPath: opts.projectPath,
    ...(logger !== undefined ? { logger } : {}),
  });
  const memory = new MemoryStore({
    projectPath: opts.projectPath,
    ...(opts.memoryRoot !== undefined ? { memoryRoot: opts.memoryRoot } : {}),
    ...(logger !== undefined ? { logger } : {}),
  });
  const permissions = new PermissionEngine({
    projectPath: opts.projectPath,
    ...(opts.userScopePath !== undefined ? { userScopePath: opts.userScopePath } : {}),
    ...(opts.enterpriseScopePath !== undefined
      ? { enterpriseScopePath: opts.enterpriseScopePath }
      : {}),
    ...(opts.permissions?.mode !== undefined ? { defaultMode: opts.permissions.mode } : {}),
    ...(logger !== undefined ? { logger } : {}),
  });
  if (opts.permissions?.autoLoad !== false) {
    await permissions.loadPermissionRules();
  }

  const session: AgentSession = Object.freeze({
    id: `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    projectPath: opts.projectPath,
    cwd: opts.projectPath,
    metadata: Object.freeze({}),
  });

  return Object.freeze({
    session,
    hooks,
    slashCommands,
    subAgents,
    skills,
    mcp,
    memory,
    permissions,
    brain: opts.brain,
    async shutdown(): Promise<void> {
      await mcp.stopAll();
    },
  });
}
