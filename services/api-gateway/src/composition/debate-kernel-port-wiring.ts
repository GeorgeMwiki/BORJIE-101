/**
 * Debate kernel-port wiring — Wave-3 closure of the DARK normal-turn
 * multi-voice debate detour (Docs/research/MASTER_WIRING_CLOSURE_PLAN.md).
 *
 * Background
 * ----------
 * The kernel's `think()` pipeline ALREADY consumes an optional `debate`
 * dep (`packages/central-intelligence/src/kernel/kernel.ts:1349-1372`):
 * when `deps.debate` is populated AND the turn is high/critical stakes AND
 * `deps.debate.shouldDebate(req)` returns true, step 7 replaces the single
 * sensor call with an N-voice debate (advocate → critic → devil's-advocate
 * → synthesiser) and uses the synthesis as the answer.
 *
 * But NO composition root ever populated `deps.debate` for the main `/ask`
 * kernel. `brain-kernel-wiring.ts` sets no debate dep; the only thing that
 * populated a kernel debate dep was `executive-brief.composition.ts`, whose
 * `buildDebate()` is (a) a passthrough `{verdict:'keep'}` STUB and (b) a
 * DIFFERENT-shape port (`debate()`) for the executive-brief flow — NOT the
 * main kernel's `{ shouldDebate, runDebate }` shape. So on a normal turn the
 * multi-voice debate detour never fired.
 *
 * This module is the real binding. It adapts the kernel's own
 * `runDebate(question, context, deps, config)` N-voice runner +
 * `DEFAULT_PROPERTY_DEBATE_VOICES` into the `{ shouldDebate, runDebate }`
 * port shape the kernel consumes, driven by the SAME Anthropic sensor the
 * kernel uses.
 *
 * NOTE: `brain-teach.hono.ts` + `services/brain-debate/` is a SEPARATE,
 * already-live multi-provider fan-out on the `/brain-teach` route — do not
 * conflate. This wiring is strictly the kernel's internal single-provider
 * N-voice deliberation on the main turn path.
 *
 * HARD-RULE compliance (closure plan):
 *   - Env flag: `BORJIE_KERNEL_DEBATE_ENABLED` (default OFF — debate fans
 *     out N voices × R rounds of LLM calls; opt-in after a staging canary).
 *   - Stakes gate: even when enabled, `shouldDebate` returns true ONLY for
 *     high / critical stakes (mirrors the kernel's own `debateEligible`).
 *   - Budget bound: `BORJIE_KERNEL_DEBATE_BUDGET_MS` (default 12000ms) +
 *     a per-debate `tokenBudget` cap. The wall-clock guard means a slow
 *     debate can NEVER stall a turn — it resolves a fail-safe outcome and
 *     the kernel falls back to the single-shot sensor path.
 *   - Fail-safe: any error / budget overrun yields an EMPTY-contributions
 *     outcome; the kernel treats that as "debate produced nothing" and uses
 *     its normal sensor result. The debate NEVER throws into the turn.
 *   - Propose-only: debate only shapes the ANSWER TEXT; it never actuates
 *     money / licence (no sovereign rail).
 *
 * Sensor reuse: the caller passes the already-wrapped Anthropic client
 * (circuit-breaker + OTel spans) from `sovereign.ts`. When no client is
 * present (no `ANTHROPIC_API_KEY`) the port is NOT built — a debate needs a
 * real sensor, and the kernel keeps its single-shot path.
 *
 * @module services/api-gateway/src/composition/debate-kernel-port-wiring
 */

import {
  createAnthropicSensor,
  runDebate,
  DEFAULT_PROPERTY_DEBATE_VOICES,
  type DebateOutcome,
  type Sensor,
} from '@borjie/central-intelligence';

import {
  organFlagDefaultOff,
  resolveBudgetMs,
  runOrganWithBudget,
} from './brain-tools/organ-budget-guard.js';

export const KERNEL_DEBATE_FLAG = 'BORJIE_KERNEL_DEBATE_ENABLED';
export const KERNEL_DEBATE_BUDGET_MS_KEY = 'BORJIE_KERNEL_DEBATE_BUDGET_MS';
const DEFAULT_DEBATE_BUDGET_MS = 12_000;
/** Token budget for the whole debate — bounds spend independent of time. */
const DEFAULT_DEBATE_TOKEN_BUDGET = 4_000;
const DEFAULT_DEBATE_MAX_ROUNDS = 2;

type AnthropicMessagesClient = Parameters<typeof createAnthropicSensor>[0];

/** The kernel's `deps.debate` port shape. */
export interface KernelDebatePort {
  shouldDebate(req: { readonly stakes?: string }): boolean;
  runDebate(question: string, context: string): Promise<DebateOutcome>;
}

export interface BuildDebatePortArgs {
  /** The wrapped Anthropic client from sovereign.ts (breaker + OTel). */
  readonly anthropic: AnthropicMessagesClient;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
  /** Injectable sensor for tests (defaults to a real Anthropic sensor). */
  readonly sensor?: Sensor;
}

export interface BuiltDebatePort {
  readonly port: KernelDebatePort;
  /** Whether the master flag enabled the debate detour (default OFF). */
  readonly enabled: boolean;
}

/** An empty debate outcome — the kernel reads this as "no debate result". */
function emptyOutcome(): DebateOutcome {
  return Object.freeze({
    contributions: [],
    synthesis: '',
    tokenSpent: 0,
    converged: false,
  });
}

/**
 * Build the kernel debate port. The returned `port.runDebate` ALWAYS
 * resolves (never rejects) — on flag-off, budget overrun, or any error it
 * returns an empty-contributions outcome so the kernel falls back to the
 * single-shot sensor path. `shouldDebate` is the stakes gate the kernel
 * AND-s with its own eligibility check.
 */
export function buildDebateKernelPort(
  args: BuildDebatePortArgs,
): BuiltDebatePort {
  const env = args.env ?? process.env;
  const enabled = organFlagDefaultOff(env, KERNEL_DEBATE_FLAG);
  const budgetMs = resolveBudgetMs(
    env,
    KERNEL_DEBATE_BUDGET_MS_KEY,
    DEFAULT_DEBATE_BUDGET_MS,
  );

  const sensor: Sensor =
    args.sensor ??
    createAnthropicSensor(args.anthropic, {
      id: 'debate-sensor',
      modelId: 'claude-sonnet-4-5',
      priority: 10,
      capabilities: ['thinking'],
      maxTokens: 1024,
    });

  const port: KernelDebatePort = {
    shouldDebate(req) {
      // Only deliberate on genuinely high-stakes turns even when enabled —
      // mirrors the kernel's own `debateEligible` so we never burn N-voice
      // spend on a low-stakes greeting.
      return (
        enabled && (req.stakes === 'high' || req.stakes === 'critical')
      );
    },
    async runDebate(question, context) {
      const outcome = await runOrganWithBudget(
        { enabled, budgetMs },
        () =>
          runDebate(
            question,
            context,
            { sensor },
            {
              voices: DEFAULT_PROPERTY_DEBATE_VOICES,
              maxRounds: DEFAULT_DEBATE_MAX_ROUNDS,
              synthesiserVoiceId: 'synthesiser',
              tokenBudget: DEFAULT_DEBATE_TOKEN_BUDGET,
            },
          ),
      );

      if (!outcome.ok) {
        args.logger?.warn?.(
          {
            wiring: 'kernel-debate',
            reason: outcome.reason,
            elapsedMs: outcome.elapsedMs,
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
          },
          'kernel-debate: debate skipped — kernel falls back to single-shot sensor',
        );
        return emptyOutcome();
      }
      return outcome.value;
    },
  };

  return Object.freeze({ port, enabled });
}
