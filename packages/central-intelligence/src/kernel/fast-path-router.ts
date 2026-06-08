/**
 * Fast-path tiered router — a cheap, deterministic intent gate that
 * decides whether a turn is TRIVIAL/SIMPLE enough to take a lightweight
 * single-call path (cheapest capable model, no LATS / debate / multi-agent
 * fan-out) instead of the full orchestrator pipeline.
 *
 * WHY
 * ---
 * Users complain about long waits. The dominant cost of a brain turn is the
 * full multi-agent pipeline. But a large fraction of real traffic is
 * trivial: greetings, acknowledgments, farewells, status pings, and
 * single-fact lookups. Running the whole pipeline for "hi" is pure latency
 * the user feels and pays for. This gate routes those to a fast lane.
 *
 * DESIGN
 * ------
 * Pure + deterministic — NO LLM call, a few µs of regex. It reuses the
 * battle-tested `classifyIntent` pattern families from `./brain-cache.ts`
 * (greeting / acknowledgment / farewell / platform_intro) and adds a
 * status-ping detector. A turn is fast-eligible when ALL hold:
 *   - the intent is a trivial family (or a short, single-clause question),
 *   - stakes are not high/critical (high-stakes always takes the full path),
 *   - there are no attachments (vision turns are never trivial),
 *   - the message is short (no long multi-part asks).
 *
 * SAFETY: the gate is CONSERVATIVE — when in doubt it returns `full`. It can
 * never route a high-stakes or attachment-bearing turn to the fast lane, so
 * the inviolable / policy / drift rails are never skipped for anything that
 * matters. The kernel still runs its hard gates on the fast lane too; the
 * fast lane only changes the MODEL TIER + skips the expensive deliberation.
 *
 * FLAGGING: behaviour change is gated by the caller via `BORJIE_FASTPATH`
 * (resolved by {@link resolveFastPathEnabled}); default is CURRENT behavior
 * (fast-path OFF) so nothing changes until an operator opts in.
 *
 * @module @borjie/central-intelligence/kernel/fast-path-router
 */

import type { ThoughtRequest } from './kernel-types.js';
import { classifyIntent, type CacheIntent } from './brain-cache.js';

/** Decision shape the kernel branches on. */
export interface FastPathDecision {
  /** 'fast' ⇒ lightweight single-call lane; 'full' ⇒ unchanged pipeline. */
  readonly route: 'fast' | 'full';
  /** Inferred intent (for telemetry / trace). */
  readonly intent: CacheIntent | 'status';
  /** Human-readable reason the route was chosen (for the decision trace). */
  readonly reason: string;
}

/** Status-ping family — "are you there?", "status", "u up?", "ping". */
const STATUS_PING_RE =
  /^(?:are\s+you\s+(?:there|online|up|working)|status|ping|you\s+there|u\s+up|still\s+there|hello\?+)\??$/i;

/**
 * Max characters for a question to still qualify as "simple single-fact".
 * Longer asks tend to be multi-part / reasoning-heavy and deserve the full
 * path. 160 chars ≈ one SMS — a deliberately tight bound.
 */
const SIMPLE_QUESTION_MAX_CHARS = 160;

/** Multi-clause / reasoning markers that disqualify the fast lane. */
const COMPLEX_MARKERS_RE =
  /\b(and then|after that|compare|versus|\bvs\b|trade-?off|analy[sz]e|step\s*by\s*step|explain\s+why|pros\s+and\s+cons|reconcile|forecast|optimi[sz]e|strategy|why\s+(?:did|does|is|are))\b|[;]|\n.*\n/i;

/**
 * Decide whether a turn can take the fast lane. Pure + deterministic.
 *
 * Returns `full` (no behaviour change) for anything non-trivial, high-stakes,
 * attachment-bearing, or marked with complexity signals.
 */
export function decideFastPath(req: ThoughtRequest): FastPathDecision {
  // High-stakes turns ALWAYS take the full deliberation path — never trade
  // safety/quality for latency on a critical decision.
  if (req.stakes === 'high' || req.stakes === 'critical') {
    return { route: 'full', intent: 'question', reason: 'stakes>=high' };
  }
  // Vision / multimodal turns are never trivial.
  if ((req.attachments?.length ?? 0) > 0) {
    return { route: 'full', intent: 'question', reason: 'has-attachments' };
  }
  // Synthesis / deep-reasoning explicitly requested ⇒ full path.
  if (req.requireSynthesis === true || req.requireJudge === true) {
    return { route: 'full', intent: 'question', reason: 'deep-reasoning-requested' };
  }

  const text = (req.userMessage ?? '').trim();
  if (text.length === 0) {
    return { route: 'full', intent: 'question', reason: 'empty-message' };
  }

  // Status pings — trivial, fast lane.
  if (STATUS_PING_RE.test(text)) {
    return { route: 'fast', intent: 'status', reason: 'status-ping' };
  }

  const { intent } = classifyIntent(text);
  // Trivial conversational families ⇒ fast lane.
  if (
    intent === 'greeting' ||
    intent === 'acknowledgment' ||
    intent === 'farewell' ||
    intent === 'platform_intro'
  ) {
    return { route: 'fast', intent, reason: `trivial-intent=${intent}` };
  }
  // Commands are mutation-bearing — never fast-lane (must run full gates).
  if (intent === 'command') {
    return { route: 'full', intent, reason: 'command-intent' };
  }
  // Simple single-fact questions: short + no complexity markers ⇒ fast lane.
  if (text.length <= SIMPLE_QUESTION_MAX_CHARS && !COMPLEX_MARKERS_RE.test(text)) {
    return { route: 'fast', intent: 'question', reason: 'simple-question' };
  }
  return { route: 'full', intent: 'question', reason: 'non-trivial-question' };
}

/**
 * Resolve the master flag for fast-path routing. Default OFF so the routing
 * decision is inert (CURRENT behavior) until an operator opts in.
 *
 * Truthy values: `1`, `true`, `on`, `yes`. Anything else (incl. UNSET) ⇒ off.
 */
export function resolveFastPathEnabled(
  env: Readonly<Record<string, string | undefined>> = typeof process !== 'undefined' &&
  process.env
    ? process.env
    : {},
): boolean {
  const raw =
    typeof env.BORJIE_FASTPATH === 'string'
      ? env.BORJIE_FASTPATH.trim().toLowerCase()
      : '';
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}
