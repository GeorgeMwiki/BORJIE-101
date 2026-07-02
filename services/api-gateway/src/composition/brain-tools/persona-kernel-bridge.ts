/**
 * Persona → kernel BrainToolSpec bridge (Approach A adapter).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The orchestrator main-loop (now the DEFAULT-ON live generator) dispatches
 * tools through the kernel's `BrainToolRegistry` (`runTool(name, input)`) and
 * discovers them by projecting that registry into the loop's `toolSearch`
 * (see `compose.ts::projectRegistryToDescriptors`). Until now the sovereign
 * composition root seeded that registry with only the 5 placeholder PM tools
 * (every executor throws "not yet wired"), so the orchestrator was strictly
 * LESS capable than the proven persona path's 40+ tool catalog.
 *
 * This module bridges the FULL persona catalog
 * (`buildPersonaToolHandlers(...)`, the same handlers the persona path uses)
 * into the kernel registry by adapting each persona `ToolHandler` to a kernel
 * `BrainToolSpec`. Because registration flows into BOTH the dispatcher AND the
 * toolSearch AND the 9-hook PreToolUse/PostToolUse/Stop chain, the persona
 * tools inherit every orchestrator rail — making the orchestrator GENUINELY
 * MORE capable than the persona path (full catalog + hooks + LATS main-loop),
 * not less.
 *
 * THE SHAPE MISMATCH (and how it is reconciled)
 * ---------------------------------------------
 * - kernel `BrainToolSpec.executor(input)` receives ONLY the input — no
 *   per-turn context.
 * - persona `ToolHandler.execute(params, context)` REQUIRES a
 *   `ToolExecutionContext` ({ tenant, actor, persona, threadId }).
 *
 * `getSovereignBrain(scope)` is cached per `(tenantId, userId, role)` scope,
 * so inside `build(scope)` we have the tenant + actor + role to close over.
 * Each adapted `BrainToolSpec.executor` therefore closes over a per-scope
 * `ToolExecutionContext` derived from that scope and calls
 * `handler.execute(input, ctx)`. The per-turn `req.scope` the kernel passes to
 * `kernel.think()` carries the SAME tenant/actor (the route resolves both from
 * one viewer), so the closed-over context is correct for every turn served by
 * this cached brain.
 *
 * Tenant isolation: the context's `tenant.tenantId` is the scope's tenant; the
 * loopback HTTP client mints a service token bound to that tenant + actor, and
 * RLS binds `app.current_tenant_id` downstream. No handler reaches across
 * tenants.
 *
 * Evidence + audit: the persona `ToolHandler` already validates input/output
 * with its zod schemas, emits the audit-chain entry for WRITE tools, and
 * surfaces an `evidenceSummary`. The kernel registry layer additionally audits
 * every deterministic call. We keep schemas permissive at the kernel boundary
 * (`z.any()` in, `z.unknown()` out) because the persona handler is the
 * authoritative validator — double-validation with a lossy re-derived schema
 * would reject valid calls.
 */

import { z } from 'zod';
import type {
  AIActor,
  AITenantContext,
  Persona,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from '@borjie/ai-copilot';
import type { BrainToolRegistry, BrainToolSpec, BrainToolTier } from '@borjie/central-intelligence';

/**
 * The SovereignRole vocabulary the composition root keys its brain cache by.
 * Kept in lock-step with `SovereignRole` in `sovereign.ts` (mirrored here so
 * this module stays a leaf with no import cycle back into the composition
 * root).
 */
export type BridgeSovereignRole =
  | 'tenant'
  | 'manager'
  | 'owner'
  | 'org-admin'
  | 'sovereign';

/** Canonical persona slugs the persona-tool catalog gates on. */
const PERSONA_SLUG_BY_ROLE: Readonly<Record<BridgeSovereignRole, string>> =
  Object.freeze({
    owner: 'T1_owner_strategist',
    'org-admin': 'T2_admin_strategist',
    sovereign: 'T2_admin_strategist',
    manager: 'T3_module_manager',
    // The brain-chat default surface — matches the index.ts persona-gate
    // fallback so a tenant-scoped viewer keeps the owner-strategist catalog.
    tenant: 'T1_owner_strategist',
  });

/**
 * Map a SovereignRole to the RBAC role string the persona-tool gate's
 * `resolvePersonaSlug` understands (it reads `ctx.actor.role`/`roles`). We set
 * BOTH the slug-bearing `roles` array AND a singular `role` field on the actor
 * so either resolution style works.
 */
const RBAC_ROLE_BY_SOVEREIGN_ROLE: Readonly<
  Record<BridgeSovereignRole, string>
> = Object.freeze({
  owner: 'OWNER',
  'org-admin': 'PLATFORM_ADMIN',
  sovereign: 'PLATFORM_ADMIN',
  manager: 'MANAGER',
  tenant: 'OWNER',
});

/**
 * FAIL-CLOSED persona slug + RBAC role for a role-less / unresolvable scope.
 * Vertical-BFLA class: a scope arriving with NO resolvable role must NOT inherit
 * the owner-tier tool ceiling. It gets the least-privileged persona
 * (`T5_customer_concierge`) — the same fail-closed default the primary persona
 * gate (`resolvePersonaSlugFromActor` in persona-slug-gate.ts) enforces. Only an
 * EXPLICITLY role-bearing scope (owner / tenant / manager / org-admin /
 * sovereign) maps to a higher persona.
 */
const FAIL_CLOSED_PERSONA_SLUG = 'T5_customer_concierge';
const FAIL_CLOSED_RBAC_ROLE = 'CUSTOMER';

export interface PersonaBridgeScope {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly role?: BridgeSovereignRole;
}

export interface RegisterPersonaToolsOnRegistryArgs {
  readonly registry: BrainToolRegistry;
  readonly handlers: ReadonlyArray<ToolHandler>;
  readonly scope: PersonaBridgeScope;
  /** Stable per-thread id folded into the tool context for provenance. */
  readonly threadId: string;
  /** Pino-style logger; no console.* per the hard rules. */
  readonly logger?: {
    readonly warn: (meta: Record<string, unknown>, msg: string) => void;
  };
}

/** Platform-tier sentinel for the tenant id (mirrors sovereign cache key). */
const PLATFORM_TENANT_SENTINEL = '__platform__';
const ANON_ACTOR_SENTINEL = '__nouser__';

/**
 * Resolve the persona slug for a scope from its EXPLICIT role. FAIL-CLOSED: a
 * role-less scope, or a role not in the slug table, resolves to the
 * least-privileged persona (`T5_customer_concierge`) — never the owner tier. A
 * role-less caller must not silently inherit the owner-strategist tool ceiling
 * (vertical BFLA). Only an explicitly role-bearing scope maps higher.
 */
export function personaSlugForScope(scope: PersonaBridgeScope): string {
  return scope.role
    ? (PERSONA_SLUG_BY_ROLE[scope.role] ?? FAIL_CLOSED_PERSONA_SLUG)
    : FAIL_CLOSED_PERSONA_SLUG;
}

/**
 * Build the per-scope `ToolExecutionContext` the persona handlers expect.
 * Closed over once per cached brain `(tenant, user, role)` and reused for
 * every tool call the orchestrator dispatches on that brain.
 */
export function buildPersonaToolContext(
  scope: PersonaBridgeScope,
  threadId: string,
): ToolExecutionContext {
  const tenantId = scope.tenantId ?? PLATFORM_TENANT_SENTINEL;
  const actorId = scope.userId ?? ANON_ACTOR_SENTINEL;
  const slug = personaSlugForScope(scope);
  // FAIL-CLOSED: a role-less / unknown-role scope binds the least-privileged
  // RBAC role (`CUSTOMER`) so the closed-over actor cannot resolve to the
  // owner-tier tool ceiling downstream — never default to `OWNER`.
  const rbacRole = scope.role
    ? (RBAC_ROLE_BY_SOVEREIGN_ROLE[scope.role] ?? FAIL_CLOSED_RBAC_ROLE)
    : FAIL_CLOSED_RBAC_ROLE;

  const tenant: AITenantContext = {
    tenantId,
    tenantName: tenantId,
    environment: 'production',
  };
  // The persona-tool gate reads `ctx.actor.role` (singular) and/or
  // `ctx.actor.roles`. `AIActor` types `roles?: string[]`; we attach the
  // RBAC role to BOTH the array and a structural `role` field so either
  // resolver style maps to the right persona slug.
  const actor = {
    type: 'user',
    id: actorId,
    roles: [rbacRole],
    role: rbacRole,
  } as AIActor & { readonly role: string };

  // The persona-tool adapter never reads `context.persona` (the gate resolves
  // the slug from `context.actor`), but the `ToolExecutionContext` interface
  // requires one. We supply a minimal, valid Persona carrying the resolved
  // slug as its id so any future reader sees the correct persona identity.
  const persona = {
    id: slug,
    kind: 'manager',
    displayName: slug,
    missionStatement: 'Persona-bridge runtime binding for orchestrator tools.',
    systemPrompt: 'Persona-bridge runtime binding.',
    allowedTools: [],
    visibilityBudget: 'management',
    defaultVisibility: 'private',
    modelTier: 'standard',
    advisorEnabled: false,
    advisorHardCategories: [],
    minReviewRiskLevel: 'LOW',
  } as Persona;

  return Object.freeze({
    tenant,
    actor,
    persona,
    threadId,
  });
}

/**
 * Map a persona handler's structural metadata to the kernel `BrainToolTier`.
 * The persona descriptor's stakes (LOW/MEDIUM/HIGH/SOVEREIGN) are carried on
 * the handler only implicitly (the adapter erases them), so we default to the
 * permissive `pro` tier — the 9-hook chain (permission / four-eye / denylist /
 * cost-circuit) is the real gate, and the kernel tier is an internal-cost
 * hint, not a security control.
 */
const DEFAULT_BRIDGE_TIER: BrainToolTier = 'pro';

/**
 * Permissive passthrough input schema. The persona handler validates its own
 * input with the descriptor's real zod schema; re-deriving a schema at the
 * kernel boundary would be lossy and could reject valid calls. `z.any()`
 * accepts the LLM's tool-call args object and defers to the handler.
 */
const PASSTHROUGH_INPUT_SCHEMA: z.ZodType<unknown> = z.any();

/**
 * Output is whatever the persona handler returns inside its
 * `ToolExecutionResult.data` (already validated by the handler's output
 * schema). `z.unknown()` lets the kernel registry pass it through unchanged so
 * the orchestrator's citation-harvester can read evidence ids off it.
 */
const PASSTHROUGH_OUTPUT_SCHEMA: z.ZodType<unknown> = z.unknown();

/**
 * The shape the kernel orchestrator's citation accumulator harvests from tool
 * outputs (`evidence_ids` / `citations` / etc. — see main-loop
 * `harvestFromOutput`). We surface the handler's `data` directly so any
 * evidence ids it carries propagate into the answer's citations, AND attach
 * the handler's `evidenceSummary` under a stable key for observability.
 */
function projectHandlerResult(result: ToolExecutionResult): unknown {
  // A failed persona tool surfaces as an executor failure to the kernel
  // dispatcher (mapped to `tool_error`) so the main loop can re-plan rather
  // than treat the denial as a successful result.
  if (!result.ok) {
    throw new Error(result.error ?? 'persona tool execution failed');
  }
  const data = result.data;
  if (data !== null && typeof data === 'object') {
    return result.evidenceSummary !== undefined
      ? { ...(data as Record<string, unknown>), _evidenceSummary: result.evidenceSummary }
      : data;
  }
  // Primitive / null data — wrap so the citation harvester sees an object and
  // the evidence summary is still carried.
  return {
    value: data ?? null,
    ...(result.evidenceSummary !== undefined
      ? { _evidenceSummary: result.evidenceSummary }
      : {}),
  };
}

/**
 * Adapt a single persona `ToolHandler` to a kernel `BrainToolSpec` whose
 * `executor(input)` closes over the per-scope `ToolExecutionContext` and calls
 * `handler.execute(input, ctx)`.
 */
export function personaHandlerToBrainToolSpec(
  handler: ToolHandler,
  ctx: ToolExecutionContext,
): BrainToolSpec<unknown, unknown> {
  return {
    name: handler.name,
    description: handler.description,
    schemaIn: PASSTHROUGH_INPUT_SCHEMA,
    schemaOut: PASSTHROUGH_OUTPUT_SCHEMA,
    tier: DEFAULT_BRIDGE_TIER,
    // The orchestrator's four-eye + permission hooks own approval gating per
    // turn; the kernel-spec flag is left false so we don't double-gate (the
    // persona path itself never gated via this flag).
    requiresApproval: false,
    async executor(input: unknown): Promise<unknown> {
      // The kernel dispatcher passes the LLM's tool-call args as `input`.
      // Persona handlers expect a `Record<string, unknown>`; coerce a
      // non-object input to an empty record so the handler's own schema is
      // the single source of validation truth.
      const params =
        input !== null && typeof input === 'object'
          ? (input as Record<string, unknown>)
          : {};
      const result = await handler.execute(params, ctx);
      return projectHandlerResult(result);
    },
  };
}

/**
 * Register the FULL persona catalog onto the kernel `BrainToolRegistry` so the
 * orchestrator main-loop can discover (toolSearch) and execute (dispatcher)
 * every persona tool through its 9-hook chain.
 *
 * Returns the count of successfully registered tools. Registration is
 * defensive per-tool: a name collision (e.g. with a seed tool already on the
 * registry) is logged and skipped rather than aborting the whole catalog, so
 * one bad tool never strands the rest.
 */
export function registerPersonaToolsOnRegistry(
  args: RegisterPersonaToolsOnRegistryArgs,
): number {
  const ctx = buildPersonaToolContext(args.scope, args.threadId);
  let registered = 0;
  for (const handler of args.handlers) {
    try {
      args.registry.register(personaHandlerToBrainToolSpec(handler, ctx));
      registered += 1;
    } catch (err) {
      args.logger?.warn(
        {
          tool: handler.name,
          reason: err instanceof Error ? err.message : String(err),
        },
        'persona-kernel-bridge: failed to register persona tool onto kernel registry (skipped)',
      );
    }
  }
  return registered;
}
