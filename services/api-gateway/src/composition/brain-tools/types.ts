/**
 * Brain-tools — shared descriptor types and runtime adapter.
 *
 * Each persona-aware tool is declared as a `PersonaToolDescriptor`:
 *
 *   - `id`                 globally-unique, dotted (e.g. `mining.cockpit.daily-brief`)
 *   - `name`               human-readable summary
 *   - `description`        prompt-facing — tells the LLM when to use this tool
 *   - `personaSlugs`       which persona slugs (from `BUILT_IN_PERSONAS`) may call it
 *   - `inputSchema`        zod validator for the call params
 *   - `outputSchema`       zod validator for the structured response
 *   - `stakes`             ActionTier — drives the persona's max_action_tier ceiling
 *   - `isWrite`            true ⇒ handler must emit an audit-chain entry
 *   - `requiresPolicyRuleLiteral`  HIGH-risk policy prefixes (sovereign / kill_switch /
 *                                  four_eye / policy_rollout) — flagged for the gate
 *   - `handler`            async function performing the work
 *
 * `toBrainToolHandler()` adapts a descriptor to the `ToolHandler` interface
 * the orchestrator's `ToolDispatcher` expects (`name`, `parameters`,
 * `execute`). The adapter:
 *
 *   1. Validates params with the input schema (returns INVALID_PARAMS on fail).
 *   2. Resolves the active persona slug from the tool-execution context.
 *   3. Refuses calls when the persona is not in `personaSlugs` (defense in
 *      depth — the persona-runtime tool catalog should already have removed
 *      it).
 *   4. Refuses calls when the kill-switch is open (fail-closed).
 *   5. Invokes the handler, validates output, optionally emits audit.
 *
 * Tenant isolation: handlers receive `context.tenant.tenantId` which the
 * api-gateway middleware already binds to `app.tenant_id` GUC. No tool
 * handler reaches across tenants.
 */

import { z } from 'zod';
import type {
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@borjie/ai-copilot';
import type { ActionTier } from '@borjie/persona-runtime';

/** Persona slugs (from `BUILT_IN_PERSONAS`) that this tool catalog targets. */
export const PERSONA_SLUGS = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
  'T4_field_employee',
  'T5_customer_concierge',
  'T_auditor',
  'T_vendor',
] as const;
export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

export interface PersonaToolHandlerContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly personaSlug: string;
  readonly auditSink?: PersonaToolAuditSink;
  readonly httpClient?: PersonaToolHttpClient;
  /**
   * Optional chat-session + turn IDs supplied by the brain orchestrator
   * when a tool call is made on behalf of a chat turn. Threaded into
   * every WRITE tool's POST body as `provenance.sessionId` /
   * `provenance.turnId` so the row's "via Mr. Mwikila" pill in the
   * downstream UI can deep-link back to the originating chat turn.
   *
   * Absent for tool calls made outside a chat (eg. scheduled cron,
   * tests). The provenance helper falls back to
   * `{via:'chat', sessionId:null, turnId:null}` in that case.
   */
  readonly chatSessionId?: string;
  readonly chatTurnId?: string;
}

export interface PersonaToolDescriptor<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly personaSlugs: ReadonlyArray<PersonaSlug>;
  readonly inputSchema: TInput;
  readonly outputSchema: TOutput;
  readonly stakes: ActionTier;
  readonly isWrite: boolean;
  /**
   * True when this tool falls under a HIGH-risk policy prefix
   * (sovereign / kill_switch / four_eye / policy_rollout). Surfaced so the
   * gate refuses any reason-resolver generalisation per the CLAUDE.md
   * hard rule.
   */
  readonly requiresPolicyRuleLiteral: boolean;
  readonly handler: (
    input: z.infer<TInput>,
    ctx: PersonaToolHandlerContext,
  ) => Promise<z.infer<TOutput>>;
}

/** Append-only audit chain entry emitted for every WRITE tool. */
export interface PersonaToolAuditEntry {
  readonly toolId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly personaSlug: string;
  readonly stakes: ActionTier;
  readonly inputDigest: string;
  readonly outcome: 'ok' | 'denied' | 'error';
  readonly occurredAt: string;
}

export interface PersonaToolAuditSink {
  append(entry: PersonaToolAuditEntry): Promise<void>;
}

/**
 * Minimal HTTP client surface — handlers can plug an internal-route
 * adapter or an in-process service via this port. Kept tiny so we don't
 * grow a transitive dependency surface here.
 */
export interface PersonaToolHttpClient {
  get<T = unknown>(
    path: string,
    init?: { readonly query?: Readonly<Record<string, string | number | undefined>> },
  ): Promise<T>;
  post<T = unknown>(
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<T>;
}

export interface PersonaToolGate {
  readonly killSwitchOpen: boolean;
  /**
   * Resolve the canonical persona slug for the current actor on the
   * current request. Returning `undefined` makes every persona-gated
   * tool refuse (fail-closed).
   */
  resolvePersonaSlug(ctx: ToolExecutionContext): string | undefined;
  /**
   * Resolve the chat-turn ID for the current tool invocation if the
   * dispatcher can derive one. Returning `undefined` leaves the
   * `provenance.turnId` field null — provenance is still well-formed,
   * just without per-turn deep-linking. The gate adapter SHOULD
   * implement this when the upstream orchestrator exposes a stable
   * per-turn ID (most do — the LLM call carries one).
   */
  resolveChatTurnId?(ctx: ToolExecutionContext): string | undefined;
  readonly auditSink?: PersonaToolAuditSink;
  readonly httpClient?: PersonaToolHttpClient;
}

const DEFAULT_TIMESTAMP = (): string => new Date().toISOString();

const hashDigest = (value: unknown): string => {
  const serialised = JSON.stringify(value ?? null);
  let hash = 5381;
  for (let i = 0; i < serialised.length; i += 1) {
    hash = ((hash << 5) + hash + serialised.charCodeAt(i)) | 0;
  }
  return `sha-djb2:${(hash >>> 0).toString(16)}`;
};

const denial = (message: string): ToolExecutionResult =>
  Object.freeze({ ok: false, error: message });

/**
 * Adapt a descriptor to the orchestrator's `ToolHandler` interface.
 * Pure factory — no module-level state.
 */
export function toBrainToolHandler<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(
  descriptor: PersonaToolDescriptor<TInput, TOutput>,
  gate: PersonaToolGate,
  options?: { readonly now?: () => string },
): ToolHandler {
  const now = options?.now ?? DEFAULT_TIMESTAMP;
  const parameters = zodToJsonSchema(descriptor.inputSchema);

  return {
    name: descriptor.id,
    description: descriptor.description,
    parameters,
    async execute(
      params: Record<string, unknown>,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      if (gate.killSwitchOpen) {
        return denial(
          `kill-switch open — ${descriptor.id} refused (fail-closed)`,
        );
      }

      const personaSlug = gate.resolvePersonaSlug(context);
      if (!personaSlug) {
        return denial(
          `persona not resolved — ${descriptor.id} refused (fail-closed)`,
        );
      }

      if (
        !(descriptor.personaSlugs as ReadonlyArray<string>).includes(
          personaSlug,
        )
      ) {
        if (gate.auditSink && descriptor.isWrite) {
          await gate.auditSink.append({
            toolId: descriptor.id,
            tenantId: context.tenant.tenantId,
            actorId: context.actor.id,
            personaSlug,
            stakes: descriptor.stakes,
            inputDigest: hashDigest(params),
            outcome: 'denied',
            occurredAt: now(),
          });
        }
        return denial(
          `persona ${personaSlug} not in allowlist for ${descriptor.id}`,
        );
      }

      const parsed = descriptor.inputSchema.safeParse(params);
      if (!parsed.success) {
        return denial(`invalid params: ${parsed.error.message}`);
      }

      try {
        const chatTurnId = gate.resolveChatTurnId?.(context);
        const handlerCtx: PersonaToolHandlerContext = Object.freeze({
          tenantId: context.tenant.tenantId,
          actorId: context.actor.id,
          personaSlug,
          ...(gate.auditSink !== undefined && { auditSink: gate.auditSink }),
          ...(gate.httpClient !== undefined && { httpClient: gate.httpClient }),
          ...(context.threadId && { chatSessionId: context.threadId }),
          ...(chatTurnId && { chatTurnId }),
        });

        const data = await descriptor.handler(parsed.data, handlerCtx);
        const validated = descriptor.outputSchema.safeParse(data);
        if (!validated.success) {
          return denial(
            `tool output invalid: ${validated.error.message}`,
          );
        }

        if (descriptor.isWrite && gate.auditSink) {
          await gate.auditSink.append({
            toolId: descriptor.id,
            tenantId: context.tenant.tenantId,
            actorId: context.actor.id,
            personaSlug,
            stakes: descriptor.stakes,
            inputDigest: hashDigest(parsed.data),
            outcome: 'ok',
            occurredAt: now(),
          });
        }

        return Object.freeze({
          ok: true,
          data: validated.data,
          evidenceSummary: `${descriptor.id} executed`,
        });
      } catch (err) {
        if (descriptor.isWrite && gate.auditSink) {
          await gate.auditSink.append({
            toolId: descriptor.id,
            tenantId: context.tenant.tenantId,
            actorId: context.actor.id,
            personaSlug,
            stakes: descriptor.stakes,
            inputDigest: hashDigest(parsed.data),
            outcome: 'error',
            occurredAt: now(),
          });
        }
        return denial(
          err instanceof Error ? err.message : `tool execution failed`,
        );
      }
    },
  };
}

/**
 * Tiny zod → JSON-schema converter. Covers the shapes our descriptors
 * declare: objects, strings, numbers, booleans, enums, arrays, optionals,
 * nullables. Anything outside this surface falls through to a permissive
 * `{ type: 'object' }` — defensive default, since the actual validation
 * is performed by the zod schema at call time.
 */
export function zodToJsonSchema(
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  const def = schema._def as { typeName?: string };
  const typeName = def?.typeName;

  if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
    const inner = (schema as unknown as { unwrap(): z.ZodTypeAny }).unwrap();
    return zodToJsonSchema(inner);
  }
  if (typeName === 'ZodDefault') {
    const innerDef = (schema as unknown as { _def: { innerType: z.ZodTypeAny } })
      ._def.innerType;
    return zodToJsonSchema(innerDef);
  }
  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodEnum') {
    const values = (schema as unknown as { _def: { values: string[] } })._def
      .values;
    return { type: 'string', enum: values };
  }
  if (typeName === 'ZodArray') {
    const itemDef = (schema as unknown as { _def: { type: z.ZodTypeAny } })._def
      .type;
    return { type: 'array', items: zodToJsonSchema(itemDef) };
  }
  if (typeName === 'ZodLiteral') {
    const value = (schema as unknown as { _def: { value: unknown } })._def.value;
    return { const: value };
  }
  if (typeName === 'ZodObject') {
    const shape = (
      schema as unknown as { shape: Record<string, z.ZodTypeAny> }
    ).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      const childDef = value._def as { typeName?: string };
      if (
        childDef?.typeName !== 'ZodOptional' &&
        childDef?.typeName !== 'ZodDefault' &&
        childDef?.typeName !== 'ZodNullable'
      ) {
        required.push(key);
      }
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  return { type: 'object' };
}
