/**
 * @borjie/action-runtime — compile.ts
 *
 * Compile a brain `Decision` (or a manual proposal from the API) into a
 * persistable `ActionPlan`. The compiler is PURE — it never writes to the
 * DB. The caller (the API route or the brain hook) drives persistence.
 *
 * Steps come from a high-level intent template + per-step `payload`.
 * The default per-kind preconditions + compensation are stitched in so
 * the saga only has to drive the step graph.
 */

import { randomUUID } from 'node:crypto';
import {
  ActionPlanSchema,
  type ActionPlan,
  type ActionStep,
  type StepKind,
  type Precondition,
  type CompensationSpec,
} from './types.js';
import {
  defaultBudgetForPlan,
} from './budget-defaults.js';

// ─────────────────────────────────────────────────────────────────────
// Input shape
// ─────────────────────────────────────────────────────────────────────

export interface CompileInputStep {
  readonly kind: StepKind;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly preconditions?: ReadonlyArray<Precondition>;
  readonly compensation?: CompensationSpec;
  readonly hitlCheckpoint?: boolean;
  readonly policyActionPrefix?: string;
  readonly routingAttributes?: Readonly<Record<string, unknown>>;
}

export interface CompileInput {
  readonly tenantId: string;
  readonly personaId: string;
  readonly moduleId?: string;
  readonly intent: string;
  readonly steps: ReadonlyArray<CompileInputStep>;
  /** Override the auto-computed budget. */
  readonly budgetMicros?: number;
  /** Cross-piece provenance. */
  readonly source?: {
    readonly captureId?: string;
    readonly briefId?: string;
    readonly documentId?: string;
  };
  /** Default 72h from now (ISO). */
  readonly expiresAt?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Default preconditions for each step kind
// ─────────────────────────────────────────────────────────────────────

const COMMON_PRECONDITIONS: ReadonlyArray<Precondition> = [
  { kind: 'kill_switch_open', failureMessage: 'platform kill-switch is open' },
  { kind: 'persona_still_bound', failureMessage: 'proposing persona is no longer bound' },
  { kind: 'budget_remaining', failureMessage: 'plan budget exhausted' },
];

function defaultPreconditionsFor(kind: StepKind): ReadonlyArray<Precondition> {
  const base = [...COMMON_PRECONDITIONS];
  switch (kind) {
    case 'POST_LEDGER':
    case 'FILE_GEPG':
    case 'MUTATE_ENTITY':
    case 'CALL_EXTERNAL_API':
      base.push({
        kind: 'autonomy_cap_within_limit',
        failureMessage: 'autonomy cap reached for this kind',
      });
      break;
    default:
      break;
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// Default compensation for each step kind
// ─────────────────────────────────────────────────────────────────────

const COMPENSATING_KINDS: ReadonlyArray<StepKind> = [
  'POST_LEDGER',
  'FILE_GEPG',
  'SEND_WHATSAPP',
  'SEND_SMS',
  'SEND_EMAIL',
  'MUTATE_ENTITY',
  'SCHEDULE_FIELD_VISIT',
  'CALL_EXTERNAL_API',
  'EMIT_WEBHOOK',
];

function defaultCompensationFor(kind: StepKind): CompensationSpec | undefined {
  if (!COMPENSATING_KINDS.includes(kind)) {
    return undefined;
  }
  return {
    handlerKey: `${kind}.reverse`,
    hardCompensation: kind === 'POST_LEDGER' || kind === 'FILE_GEPG',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Compile a plan
// ─────────────────────────────────────────────────────────────────────

export function compile(input: CompileInput): ActionPlan {
  if (input.steps.length === 0) {
    throw new Error('compile: plan must have at least one step');
  }

  const planId = `ap_${randomUUID()}`;
  const expiresAt =
    input.expiresAt ??
    new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const steps: ActionStep[] = input.steps.map((s, idx) => {
    const stepId = `as_${planId.slice(3, 11)}_${idx}_${randomUUID().slice(0, 8)}`;
    const toolCallRef =
      `${planId}:${idx}:${s.kind}:${shortHash(s.payload ?? {})}`;
    return {
      id: stepId,
      stepIndex: idx,
      kind: s.kind,
      payload: { ...(s.payload ?? {}) },
      preconditions: s.preconditions
        ? [...s.preconditions]
        : [...defaultPreconditionsFor(s.kind)],
      hitlCheckpoint: s.hitlCheckpoint ?? (s.kind === 'ROUTE_APPROVAL'),
      ...(s.policyActionPrefix ? { policyActionPrefix: s.policyActionPrefix } : {}),
      ...(s.routingAttributes ? { routingAttributes: { ...s.routingAttributes } } : {}),
      ...(s.compensation
        ? { compensation: { ...s.compensation } }
        : (() => {
            const c = defaultCompensationFor(s.kind);
            return c ? { compensation: c } : {};
          })()),
      toolCallRef,
    } as ActionStep;
  });

  const stepKinds = steps.map((s) => s.kind);
  const budget = input.budgetMicros ?? defaultBudgetForPlan(stepKinds);

  const plan: ActionPlan = {
    id: planId,
    tenantId: input.tenantId,
    personaId: input.personaId,
    ...(input.moduleId ? { moduleId: input.moduleId } : {}),
    intent: input.intent,
    steps,
    budgetMicros: budget,
    ...(input.source ? { source: { ...input.source } } : {}),
    expiresAt,
  };

  // Validate against the canonical Zod schema before returning.
  return ActionPlanSchema.parse(plan);
}

// ─────────────────────────────────────────────────────────────────────
// shortHash — 8-char stable hash for idempotency key suffixes.
// Pure non-crypto FNV-1a so we don't drag node:crypto into the hot path.
// ─────────────────────────────────────────────────────────────────────

function shortHash(value: unknown): string {
  const stable = canonical(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i += 1) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}
