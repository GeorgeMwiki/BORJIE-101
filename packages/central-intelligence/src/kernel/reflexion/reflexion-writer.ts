/**
 * Reflexion writer — verbal-RL pattern per Shinn et al. (NeurIPS 2023).
 *
 * At session end the kernel writes a short verbal reflection so the
 * NEXT session for the same (tenant, user) can read it and avoid
 * repeating the same mistake. Pure prompt-layer; the base model
 * weights are never touched.
 *
 * "Session end" is signalled by the kernel one of two ways:
 *   - explicit terminator ("bye", "thanks that's all", "/end")
 *   - idle for ≥ 5 minutes after the last turn
 *
 * The writer composes the reflection text from:
 *   - the session's high-level intent (last user message)
 *   - the outcome (success / failure / mixed) — caller-supplied
 *   - up to 3 verbatim "what didn't go well" bullets harvested from
 *     in-session feedback / self-RAG blocks / override audits
 *
 * The actual judgement of success/failure is upstream — the kernel
 * computes it from explicit thumbs (negative ⇒ failure), Self-RAG
 * blocks (≥1 block ⇒ failure), implicit signals (override ⇒ failure,
 * copy ⇒ success), and fall-through (mixed).
 */

export type ReflexionOutcome = 'success' | 'failure' | 'mixed';

export interface ReflexionWriterPort {
  record(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly reflection: string;
    readonly outcome: ReflexionOutcome;
  }): Promise<{ id: string }>;
}

export interface BuildReflectionInput {
  readonly userMessage: string;
  readonly outcome: ReflexionOutcome;
  /** Verbatim "what didn't go well" notes; truncated to 3 bullets. */
  readonly negativeNotes?: ReadonlyArray<string>;
  /** Optional grounding — what was retrieved during the session. */
  readonly groundedFacts?: ReadonlyArray<string>;
}

const MAX_BULLETS = 3;
const MAX_REFLECTION_CHARS = 1_200;
const NEGATIVE_NOTE_MAX_LEN = 200;

/**
 * Compose the literal reflection string. Pure function — no side
 * effects. The caller hands the result to `recordReflection(...)` to
 * persist.
 */
export function buildReflection(input: BuildReflectionInput): string {
  const lines: string[] = [];
  const intent = (input.userMessage ?? '').trim();
  if (intent) {
    lines.push(`Intent: ${truncate(intent, 200)}`);
  }
  lines.push(`Outcome: ${input.outcome}`);

  const notes = (input.negativeNotes ?? [])
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter((n) => n.length > 0)
    .slice(0, MAX_BULLETS);
  if (notes.length > 0) {
    lines.push('Lessons:');
    for (const note of notes) {
      lines.push(`- ${truncate(note, NEGATIVE_NOTE_MAX_LEN)}`);
    }
  }
  if (input.groundedFacts && input.groundedFacts.length > 0) {
    lines.push(
      `Grounded facts used: ${truncate(
        input.groundedFacts.join('; '),
        300,
      )}`,
    );
  }
  return truncate(lines.join('\n'), MAX_REFLECTION_CHARS);
}

export interface RecordReflectionArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly outcome: ReflexionOutcome;
  readonly negativeNotes?: ReadonlyArray<string>;
  readonly groundedFacts?: ReadonlyArray<string>;
}

/**
 * High-level wrapper: build + record. Returns the new row id, or null
 * when the write fails / inputs are invalid.
 */
export async function recordReflection(
  port: ReflexionWriterPort,
  args: RecordReflectionArgs,
): Promise<string | null> {
  if (!args.tenantId || !args.userId || !args.sessionId) {
    return null;
  }
  const reflection = buildReflection({
    userMessage: args.userMessage,
    outcome: args.outcome,
    ...(args.negativeNotes ? { negativeNotes: args.negativeNotes } : {}),
    ...(args.groundedFacts ? { groundedFacts: args.groundedFacts } : {}),
  });
  if (!reflection.trim()) return null;

  try {
    const out = await port.record({
      tenantId: args.tenantId,
      userId: args.userId,
      sessionId: args.sessionId,
      reflection,
      outcome: args.outcome,
    });
    return out?.id ?? null;
  } catch {
    // Side-channel — never bubble up.
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Session-end detection (pure heuristics)
// ──────────────────────────────────────────────────────────────────────

const TERMINATOR_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*\/end\b/i,
  /^\s*bye\b/i,
  /^\s*goodbye\b/i,
  /^\s*see (?:you|ya)\b/i,
  /^\s*thanks?[,!\s]*(?:that['’]?s all|bye|done)\b/i,
];

export function isExplicitSessionTerminator(message: string): boolean {
  if (!message) return false;
  for (const rx of TERMINATOR_PATTERNS) {
    if (rx.test(message)) return true;
  }
  return false;
}

const DEFAULT_IDLE_MS = 5 * 60 * 1000;

export interface IdleEndArgs {
  readonly lastTurnAt: number;
  readonly now: number;
  readonly idleMs?: number;
}

export function isIdleSessionEnd(args: IdleEndArgs): boolean {
  if (!Number.isFinite(args.lastTurnAt) || !Number.isFinite(args.now)) {
    return false;
  }
  const idleMs = args.idleMs ?? DEFAULT_IDLE_MS;
  return args.now - args.lastTurnAt >= idleMs;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
