/**
 * The AOP grammar — runtime Zod schemas that are the single source of truth
 * for both validation and TypeScript types (via z.infer).
 *
 * Step kinds:
 *   - tool     : invoke a registered BrainToolRegistry tool with args
 *   - monitor  : wait for an event or a timer, then transition
 *   - hook     : pause for human approval (ask-owner, sandbox-divert, 4-eye)
 *   - loop     : repeat a body of steps until an exit condition holds
 *
 * Invariants enforced at the schema layer:
 *   - Step ids are non-empty kebab-case-ish strings
 *   - Tool steps must declare `tool` + `args`
 *   - Monitors must declare a timeout (no infinite waits)
 *   - Loops must declare an `exit_when` condition
 *
 * Cross-step invariants (orphan refs, cycles, terminal step) are enforced by
 * `validator/invariant-validator.ts`, not here.
 */

import { z } from 'zod';

const stepIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/, 'step id must be lowercase kebab/snake');

const cronExprSchema = z
  .string()
  .min(1)
  // Permit standard 5-field, 6-field (with seconds), or @keyword form.
  .regex(
    /^(@(annually|yearly|monthly|weekly|daily|hourly|reboot)|(\S+\s+){4,5}\S+)$/,
    'invalid cron expression',
  );

/** A bounded duration string: e.g. "3d", "12h", "30m", "45s". */
const durationSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h|d|w)$/, 'duration must be like 30s, 5m, 3d, 1w');

export const AOPHookKindSchema = z.enum([
  'ask-owner',
  'sandbox-divert',
  '4-eye',
]);

export const AOPTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cron'),
    schedule: cronExprSchema,
    timezone: z.string().optional(),
  }),
  z.object({
    kind: z.literal('event'),
    event: z.string().min(1),
    filter: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('manual'),
    title: z.string().min(1).optional(),
  }),
]);

export const AOPInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('query'),
    query: z.object({
      table: z.string().min(1),
      where: z.record(z.unknown()).optional(),
      limit: z.number().int().positive().optional(),
    }),
  }),
  z.object({
    source: z.literal('event-payload'),
  }),
  z.object({
    source: z.literal('static'),
    value: z.record(z.unknown()),
  }),
]);

/** A monitor must either wait on an event OR a timer (or both via OR). */
export const AOPMonitorSchema = z.object({
  kind: z.literal('wait'),
  until_event: z.string().min(1).optional(),
  OR: z
    .object({
      kind: z.literal('timer'),
      duration: durationSchema,
    })
    .optional(),
  /** Hard timeout — required to prevent infinite waits. */
  timeout: durationSchema,
});

/**
 * Recursive step schema. Zod has limited support for recursive
 * discriminatedUnion, so we model `loop.body` with z.lazy + a getter.
 */
type AOPStep =
  | {
      kind: 'tool';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      on_success?: string | undefined;
      on_failure?: string | undefined;
    }
  | {
      kind: 'monitor';
      id: string;
      monitor: z.infer<typeof AOPMonitorSchema>;
      on_trigger: string;
    }
  | {
      kind: 'hook';
      id: string;
      hook: z.infer<typeof AOPHookKindSchema>;
      prompt?: string | undefined;
      on_approve?: string | undefined;
      on_reject?: string | undefined;
    }
  | {
      kind: 'loop';
      id: string;
      body: AOPStep[];
      exit_when: { kind: 'count'; max: number } | { kind: 'event'; event: string };
    };

const baseToolStep = z.object({
  kind: z.literal('tool'),
  id: stepIdSchema,
  tool: z.string().min(1),
  args: z.record(z.unknown()),
  on_success: stepIdSchema.optional(),
  on_failure: stepIdSchema.optional(),
});

const baseMonitorStep = z.object({
  kind: z.literal('monitor'),
  id: stepIdSchema,
  monitor: AOPMonitorSchema,
  on_trigger: stepIdSchema,
});

const baseHookStep = z.object({
  kind: z.literal('hook'),
  id: stepIdSchema,
  hook: AOPHookKindSchema,
  prompt: z.string().optional(),
  on_approve: stepIdSchema.optional(),
  on_reject: stepIdSchema.optional(),
});

const exitWhenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count'), max: z.number().int().positive() }),
  z.object({ kind: z.literal('event'), event: z.string().min(1) }),
]);

export const AOPStepSchema: z.ZodType<AOPStep> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    baseToolStep,
    baseMonitorStep,
    baseHookStep,
    z.object({
      kind: z.literal('loop'),
      id: stepIdSchema,
      body: z.array(AOPStepSchema).min(1),
      exit_when: exitWhenSchema,
    }),
  ]),
);

/**
 * Hard upper bound on top-level step count.
 *
 * H5 (audit prompt: "AOP-level step-count cap"): an LLM-emitted AOP with
 * tens of thousands of steps would pass parser/validate today. Loops have
 * their own `exit_when.max` but the outer steps array did not. 200 steps
 * is well above any production SOP the team has authored (the longest
 * fixture is the arrears-chase loop with ~12 steps) and below the
 * platform's autonomy + cost budget.
 */
export const AOP_MAX_STEPS = 200;

export const AOPSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, 'aop name must be lowercase kebab'),
  version: z.string().default('0.1.0'),
  description: z.string().optional(),
  trigger: AOPTriggerSchema,
  input: AOPInputSchema.optional(),
  steps: z
    .array(AOPStepSchema)
    .min(1, 'AOP must declare at least one step')
    .max(AOP_MAX_STEPS, `AOP must declare at most ${AOP_MAX_STEPS} steps`),
  /** The id of the first step to run. Defaults to steps[0].id. */
  entry: stepIdSchema.optional(),
  /**
   * Explicit allowlist of PII keys this AOP is permitted to pass into tool
   * args. Without listing the key here, the permission-validator rejects
   * the AOP at compile time. Conservative: empty by default; LLM-authored
   * AOPs that try to ferry `kra_pin` etc. through a write-tier tool
   * must be edited by a human reviewer to add the explicit grant.
   */
  grants: z.array(z.string().min(1)).optional(),
});
