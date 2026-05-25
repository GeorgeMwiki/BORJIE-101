/**
 * Per-tenant brain-dependent agent-stack composition (P75 follow-up).
 *
 * The LITFIN-port batch-4 wiring (`litfin-agent-stack-wiring.ts`) ships
 * the 6 packages as namespaces because their brain-dependent factories
 * (`createOrchestrator({ brain })`, `createOpenCodingAgent({ brain })`,
 * `createAgentRuntime({ projectPath, brain? })`) cannot be statically
 * bound at boot — every brain port must be tenant-scoped so the
 * budget-guarded Anthropic SDK debits the right tenant's cap. This
 * helper bridges that gap with a per-tenant LRU+TTL cache.
 *
 * Members assembled per tenant:
 *
 *   - `brain` — an `agent-orchestrator` `BrainPort` backed by the
 *     budget-guarded Anthropic SDK (tenant id captured in the
 *     closure). Adapts `{system, messages, ...}` to the SDK's
 *     `messages.create` shape and surfaces `{text, toolCalls, usage,
 *     model, stopReason}`.
 *
 *   - `orchestrator` — `createOrchestrator({ brain })` from
 *     `@borjie/agent-orchestrator`. Default brain shape; no
 *     budget / durable / judge layers (consumers opt in per call).
 *
 *   - `openCodingAgent` — `createOpenCodingAgent({ brain: openCodingBrain })`
 *     from `@borjie/open-coding-agent-patterns`. ONLY assembled
 *     when `enableOpenCodingAgent: true` because it allocates a
 *     repo-map + sandbox + browser shell — heavy and rarely needed
 *     on the BFF path.
 *
 *   - `agentRuntimeFactory` — async lazy factory because
 *     `createAgentRuntime({ projectPath, brain })` walks the project
 *     filesystem (slash commands, sub-agents, skills, MCP config).
 *     Consumers invoke it per project / per worker; the per-tenant
 *     brain is pre-bound so call sites only supply `projectPath`.
 *
 *   - `agenticOs` — left `null` for now. `createAgenticOS` requires 5+
 *     concrete ports (brain, orchestrator, agentRegistry, constitution,
 *     kg) — once the agent-registry + constitution + KG ports converge
 *     under a single namespace (P85 follow-up) we wire it here.
 *
 * Cache: 100 tenants × 5 min TTL. Sized for the gateway's per-instance
 * tenant turnover (a typical replica handles 20-80 active tenants in a
 * 5 min window; 100 leaves headroom for tail-tenant churn without ever
 * touching the legacy-portal bridge's larger map). TTL is short because
 * the cache holds no per-request state — only Anthropic-bound brain
 * closures — and we want gateway restarts / cap-config changes to
 * propagate within minutes, not hours.
 *
 * The cache is bounded and TTL'd to prevent unbounded memory growth
 * across a long-running gateway replica handling 10k+ distinct tenants
 * over its lifetime. Eviction is purely LRU; brain closures don't hold
 * subscriptions, file handles, or sockets so dropping them is safe.
 */
import * as AgentOrchestratorNs from '@borjie/agent-orchestrator';
import * as OpenCodingAgentPatternsNs from '@borjie/open-coding-agent-patterns';
import * as AgentRuntimeNs from '@borjie/agent-runtime';

import type {
  BrainPort as OrchestratorBrainPort,
  BrainCallRequest as OrchestratorBrainCallRequest,
  BrainCallResponse as OrchestratorBrainCallResponse,
  Orchestrator,
  TokenUsage,
} from '@borjie/agent-orchestrator';
import type {
  BrainPort as OpenCodingBrainPort,
  BrainRequest as OpenCodingBrainRequest,
  BrainResponse as OpenCodingBrainResponse,
  OpenCodingAgent,
} from '@borjie/open-coding-agent-patterns';
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  BrainPort as RuntimeBrainPort,
  BrainCallArgs as RuntimeBrainCallArgs,
  BrainCallResult as RuntimeBrainCallResult,
} from '@borjie/agent-runtime';

// ---------------------------------------------------------------------------
// Anthropic SDK structural duck-shape — kept local so this wiring file does
// not pick up a hard dependency on `@anthropic-ai/sdk` or `@borjie/
// ai-copilot/providers`. The structural shape matches
// `BudgetGuardedAnthropicClient` from `packages/ai-copilot/src/providers/
// budget-guard.ts`.
// ---------------------------------------------------------------------------

export interface AnthropicSdkLike {
  readonly messages: {
    create(request: {
      model: string;
      max_tokens: number;
      temperature?: number;
      system?: string;
      messages: ReadonlyArray<{
        readonly role: 'user' | 'assistant';
        readonly content: string;
      }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
      stop_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    }>;
  };
}

export interface BudgetGuardedAnthropicClientLike {
  readonly defaultModel: string;
  readonly sdk: AnthropicSdkLike;
}

export type BudgetGuardedAnthropicFactory = (
  tenantId: string,
  operation?: string,
) => BudgetGuardedAnthropicClientLike;

// ---------------------------------------------------------------------------
// Per-tenant assembled stack
// ---------------------------------------------------------------------------

export interface AgentStack {
  /** Tenant the stack was assembled for. Surfaced for telemetry. */
  readonly tenantId: string;
  /**
   * Anthropic-backed `BrainPort` matching the agent-orchestrator shape.
   * The closure captures the tenant id so every call routes through the
   * tenant's budget-guarded Anthropic SDK. `null` when no Anthropic key
   * is configured (consumers fall back to their degraded paths).
   */
  readonly brain: OrchestratorBrainPort | null;
  /**
   * Pre-built `Orchestrator` with the tenant-scoped brain. `null` when
   * no brain is available. Consumers can `createOrchestrator` themselves
   * for finer-grained cost / durable / judge wiring.
   */
  readonly orchestrator: Orchestrator | null;
  /**
   * Pre-built `OpenCodingAgent` ONLY when `enableOpenCodingAgent: true`
   * was passed. Heavy (repo-map + sandbox + browser shell) so we
   * skip it by default.
   */
  readonly openCodingAgent: OpenCodingAgent | null;
  /**
   * Lazy async factory for the Claude-Code-parity `AgentRuntime`. The
   * tenant-scoped brain is pre-bound so callers only supply
   * `projectPath` (+ optional permissions / memory paths). Async because
   * the runtime walks the project filesystem for slash commands,
   * sub-agents, skills, and MCP config.
   */
  readonly agentRuntimeFactory: (
    opts: Omit<AgentRuntimeOptions, 'brain'>,
  ) => Promise<AgentRuntime>;
  /**
   * `null` for now — `createAgenticOS` needs 5+ concrete ports
   * (brain, orchestrator, agentRegistry, constitution, kg) that
   * have not yet converged under a single namespace. Wired in a
   * follow-up.
   */
  readonly agenticOs: null;
}

// ---------------------------------------------------------------------------
// Brain adapters — wrap the budget-guarded Anthropic SDK in each package's
// duck-typed BrainPort shape. Adapters are pure thin shims; no caching or
// retry logic (the kernel / brain-kernel-wiring owns that).
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 1024;

function extractText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  let out = '';
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string') {
      out += part.text;
    }
  }
  return out;
}

function mapStopReason(
  raw: string | undefined,
): OrchestratorBrainCallResponse['stopReason'] {
  switch (raw) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

function mapUsage(raw: {
  input_tokens?: number;
  output_tokens?: number;
} | undefined): TokenUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
  };
}

/**
 * Wrap a budget-guarded Anthropic client in the agent-orchestrator
 * `BrainPort` shape. The package's port supports `messages` (multi-turn)
 * + system prompt + max-tokens; we drop tools / structured-output for
 * now (the agent-orchestrator's tool dispatch path lives in a follow-
 * up wave — today's wiring covers the single-turn + multi-turn text
 * shape only).
 */
function buildOrchestratorBrain(
  client: BudgetGuardedAnthropicClientLike,
): OrchestratorBrainPort {
  return Object.freeze<OrchestratorBrainPort>({
    async call(req: OrchestratorBrainCallRequest): Promise<OrchestratorBrainCallResponse> {
      const messages = req.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      const response = await client.sdk.messages.create({
        model: client.defaultModel,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages,
      });
      return Object.freeze<OrchestratorBrainCallResponse>({
        text: extractText(response.content),
        toolCalls: [],
        usage: mapUsage(response.usage),
        model: client.defaultModel,
        stopReason: mapStopReason(response.stop_reason),
      });
    },
  });
}

/**
 * Wrap a budget-guarded Anthropic client in the open-coding-agent
 * `BrainPort` shape (`generate` returning `{text, usage?}`).
 */
function buildOpenCodingBrain(
  client: BudgetGuardedAnthropicClientLike,
): OpenCodingBrainPort {
  return Object.freeze<OpenCodingBrainPort>({
    async generate(req: OpenCodingBrainRequest): Promise<OpenCodingBrainResponse> {
      const response = await client.sdk.messages.create({
        model: client.defaultModel,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: req.prompt }],
      });
      const usage = mapUsage(response.usage);
      return Object.freeze<OpenCodingBrainResponse>({
        text: extractText(response.content),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
      });
    },
  });
}

/**
 * Wrap a budget-guarded Anthropic client in the agent-runtime
 * `BrainPort` shape (`call({prompt, systemPrompt?, ...})` returning
 * `{text, modelUsed}`). Used by the agent-runtime's slash-commands +
 * sub-agents subsystems.
 */
function buildRuntimeBrain(
  client: BudgetGuardedAnthropicClientLike,
): RuntimeBrainPort {
  return Object.freeze<RuntimeBrainPort>({
    async call(args: RuntimeBrainCallArgs): Promise<RuntimeBrainCallResult> {
      const response = await client.sdk.messages.create({
        model: args.model ?? client.defaultModel,
        max_tokens: DEFAULT_MAX_TOKENS,
        ...(args.systemPrompt ? { system: args.systemPrompt } : {}),
        messages: [{ role: 'user', content: args.prompt }],
      });
      return Object.freeze<RuntimeBrainCallResult>({
        text: extractText(response.content),
        modelUsed: args.model ?? client.defaultModel,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Per-tenant cache — TTL'd LRU. Sized for typical gateway replica turnover
// (100 tenants × 5 min). Inline impl to avoid pulling `lru-cache` as a new
// runtime dep — the brain wrapper closures are small and eviction logic is
// trivial (no need for the full lru-cache API surface).
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly stack: AgentStack;
  readonly expiresAtMs: number;
}

const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Bounded LRU+TTL cache. JS `Map` keeps insertion order; touching a key
 * (`get` hit) re-inserts so the head of `keys()` is always the LRU
 * victim. Eviction trims to `max` after every insert.
 */
export class AgentStackCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(opts?: { readonly max?: number; readonly ttlMs?: number }) {
    this.maxSize = opts?.max ?? CACHE_MAX_SIZE;
    this.ttlMs = opts?.ttlMs ?? CACHE_TTL_MS;
  }

  get(tenantId: string, now: number = Date.now()): AgentStack | null {
    const entry = this.entries.get(tenantId);
    if (entry === undefined) return null;
    if (entry.expiresAtMs <= now) {
      this.entries.delete(tenantId);
      return null;
    }
    // Touch — move to MRU position by re-inserting.
    this.entries.delete(tenantId);
    this.entries.set(tenantId, entry);
    return entry.stack;
  }

  set(tenantId: string, stack: AgentStack, now: number = Date.now()): void {
    const expiresAtMs = now + this.ttlMs;
    // Re-insert so we move to MRU position even on overwrite.
    this.entries.delete(tenantId);
    this.entries.set(tenantId, { stack, expiresAtMs });
    while (this.entries.size > this.maxSize) {
      const lruKey = this.entries.keys().next().value;
      if (lruKey === undefined) break;
      this.entries.delete(lruKey);
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory + cached factory
// ---------------------------------------------------------------------------

export interface CreateAgentStackArgs {
  readonly tenantId: string;
  /**
   * Per-tenant budget-guarded Anthropic factory (`null` when
   * ANTHROPIC_API_KEY is unset). When null, the assembled stack has
   * `brain: null` + `orchestrator: null` + `openCodingAgent: null`;
   * `agentRuntimeFactory` still works but the runtime falls back to
   * its no-brain path (slash commands + sub-agents needing a model
   * surface a deterministic refusal).
   */
  readonly buildBudgetGuardedAnthropicClient: BudgetGuardedAnthropicFactory | null;
  /**
   * Default = false. When true, the per-tenant cache also pre-builds an
   * `OpenCodingAgent`. Off by default because the open-coding pipeline
   * pulls a repo-map + sandbox + browser shell; consumers explicitly opt
   * in (typically a build-bot / agent-platform endpoint).
   */
  readonly enableOpenCodingAgent?: boolean;
  /** Optional logger for diagnostic emission when fallbacks fire. */
  readonly logger?: {
    readonly warn?: (meta: object, msg?: string) => void;
  };
}

/**
 * Assemble the per-tenant agent stack synchronously. Brain port + the
 * brain-dependent stacks are built immediately; the agent-runtime
 * factory is kept lazy because the runtime walks the project filesystem
 * (slash commands + sub-agents + skills + MCP config) on construction.
 */
export function createAgentStackForTenant(
  args: CreateAgentStackArgs,
): AgentStack {
  const { tenantId, buildBudgetGuardedAnthropicClient, enableOpenCodingAgent, logger } = args;

  if (buildBudgetGuardedAnthropicClient === null) {
    logger?.warn?.(
      { where: 'agent-stack-brain-wiring', tenantId },
      'ANTHROPIC_API_KEY unset — brain-dependent agent stack returns null brain (consumers fall back to degraded paths)',
    );
    return Object.freeze<AgentStack>({
      tenantId,
      brain: null,
      orchestrator: null,
      openCodingAgent: null,
      agentRuntimeFactory: async (opts) => AgentRuntimeNs.createAgentRuntime(opts),
      agenticOs: null,
    });
  }

  const anthropicClient = buildBudgetGuardedAnthropicClient(tenantId, 'agent-stack');
  const brain = buildOrchestratorBrain(anthropicClient);
  const orchestrator = AgentOrchestratorNs.createOrchestrator({ brain });

  const openCodingAgent = enableOpenCodingAgent === true
    ? OpenCodingAgentPatternsNs.createOpenCodingAgent({
        brain: buildOpenCodingBrain(anthropicClient),
      })
    : null;

  const runtimeBrain = buildRuntimeBrain(anthropicClient);
  const agentRuntimeFactory = async (
    opts: Omit<AgentRuntimeOptions, 'brain'>,
  ): Promise<AgentRuntime> =>
    AgentRuntimeNs.createAgentRuntime({ ...opts, brain: runtimeBrain });

  return Object.freeze<AgentStack>({
    tenantId,
    brain,
    orchestrator,
    openCodingAgent,
    agentRuntimeFactory,
    agenticOs: null,
  });
}

/**
 * Cached factory — assembles a stack on miss and reuses it for the TTL
 * window. Composition root exposes this through the ServiceRegistry as
 * `getAgentStackForTenant(tenantId)`.
 */
export function makeCachedAgentStackFactory(
  cache: AgentStackCache,
  baseArgs: Omit<CreateAgentStackArgs, 'tenantId'>,
): (tenantId: string) => AgentStack {
  return (tenantId: string): AgentStack => {
    const cached = cache.get(tenantId);
    if (cached !== null) return cached;
    const fresh = createAgentStackForTenant({ ...baseArgs, tenantId });
    cache.set(tenantId, fresh);
    return fresh;
  };
}

/**
 * Convenience composition root: build a fresh `AgentStackCache` and
 * return the bound `getAgentStackForTenant` factory. The cache is
 * exposed on the return value for ops introspection (size / clear).
 */
export interface AgentStackBundle {
  readonly cache: AgentStackCache;
  readonly getAgentStackForTenant: (tenantId: string) => AgentStack;
}

export function createAgentStackBundle(
  args: Omit<CreateAgentStackArgs, 'tenantId'>,
  cacheOpts?: { readonly max?: number; readonly ttlMs?: number },
): AgentStackBundle {
  const cache = new AgentStackCache(cacheOpts);
  const getAgentStackForTenant = makeCachedAgentStackFactory(cache, args);
  return Object.freeze({ cache, getAgentStackForTenant });
}
