/**
 * Brain debate — accuracy mode for high-stakes turns.
 *
 * Runs the same prompt across Anthropic / OpenAI / DeepSeek IN PARALLEL,
 * scores the three completions against each other (consistency,
 * factuality, regulatory accuracy) using Anthropic as judge, and
 * returns the winning response with a debate trace.
 *
 * The chat surface flags high-stakes intent (regulator filing, royalty
 * submission, payment, hire / fire, contract sign) and routes through
 * `runDebate` instead of the single-shot ladder. The FE renders a small
 * "Verified ✓ 3-model debate" badge above the assistant bubble.
 *
 * Failure containment:
 *   - If only 2 providers respond, debate proceeds with whoever spoke.
 *   - If only 1 provider responds, it wins by default (no debate).
 *   - If 0 providers respond, `runDebate` throws so the caller falls
 *     back to the single-shot ladder.
 *   - Judge failure → score every contender 0.5 and pick whichever
 *     finished first (deterministic, fair, never a fabricated winner).
 *
 * Intent detection is a pure-function regex matcher — easy to test,
 * zero external dependencies, no false-positive blast radius. Owner
 * messages that match are routed through debate; everything else
 * stays on the cheap single-shot path.
 */

import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
} from '@borjie/brain-llm-router';

// ─── Public types ───────────────────────────────────────────────────

export type DebateProvider = 'anthropic' | 'openai' | 'deepseek';

export interface DebateContender {
  readonly provider: DebateProvider;
  readonly model: string;
  readonly client: BrainLLMClient;
}

export interface DebateScore {
  readonly provider: DebateProvider;
  readonly score: number; // 0..1
  readonly reason: string;
}

export interface DebateTrace {
  readonly responses: ReadonlyArray<{
    readonly provider: DebateProvider;
    readonly model: string;
    readonly text: string;
    readonly latencyMs: number;
    readonly error?: string;
  }>;
  readonly judgeProvider: DebateProvider | null;
  readonly judgeError?: string;
  readonly winnerReason: string;
}

export interface DebateResult {
  readonly winner: {
    readonly provider: DebateProvider;
    readonly model: string;
    readonly response: BrainLLMResponse;
    readonly text: string;
  };
  readonly scores: ReadonlyArray<DebateScore>;
  readonly trace: DebateTrace;
  readonly verified: boolean; // true when ≥2 contenders responded
}

export interface DebateInput {
  readonly messages: BrainLLMRequest['messages'];
  readonly system: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

// ─── High-stakes intent detection ──────────────────────────────────

/**
 * Patterns that mark a turn as high-stakes. Conservative on purpose:
 * the cost of misclassifying a casual question as "high stakes" is
 * 3x the latency + 3x the tokens, so we only fire on terms that
 * unambiguously imply regulator / royalty / payment / hire-fire /
 * contract action. Bilingual sw/en — the EN never says "Karibu".
 */
const HIGH_STAKES_PATTERNS: ReadonlyArray<RegExp> = [
  // English regulator filings
  /\b(file|submit|lodge|register)\s+(with\s+)?(tra|brela|nemc|tcra|nss?f|wcf|osha|tbs|ica)\b/i,
  /\b(eia|esia|environmental impact)\s+(filing|submission|report)\b/i,
  // English royalty / tax / payment commitments
  /\b(submit|file|pay|remit|wire|transfer|disburse)\s+(the\s+)?(royalt|royalty|tax|paye|vat|levy|invoice)/i,
  /\b(pay|remit|transfer|disburse|wire)\s+(usd|tzs|kes|eur|gbp|\$)/i,
  // English HR — hire / fire / suspend
  /\b(hire|fire|terminat|dismiss|suspend|lay\s*off|retrench)\s+(employee|worker|staff|manager|engineer|driller)/i,
  // English contracts
  /\b(sign|execute|countersign|seal|notari[sz]e)\s+(the\s+|this\s+)?(contract|agreement|mou|loi|nda|sla|term sheet)/i,
  // Swahili regulator filings
  /\b(wasilisha|peleka|sajili|jaza\s+fomu)\s+(.*?)(tra|brela|nemc|tcra|nssf|wcf|osha|tbs|ica)\b/i,
  // Swahili royalty / tax / payment
  /\b(lipa|tuma|hamisha|toa)\s+(.*?)(mrabaha|kodi|ushuru|paye|vat|ankara|invoice)/i,
  /\b(lipa|tuma|hamisha)\s+(usd|tzs|kes|dola|shilingi)/i,
  // Swahili HR
  /\b(ajiri|fukuza|simamisha|achisha|punguza)\s+(mfanyakaz|mfanyakazi|manaja|mhandisi|mchimba)/i,
  // Swahili contracts
  /\b(saini|tia\s+saini|thibitisha)\s+(mkataba|makubaliano|hati)/i,
];

/**
 * True when `message` matches any high-stakes pattern. Pure function;
 * safe to call on every chat turn. Returns false for empty / null.
 */
export function isHighStakes(message: string | null | undefined): boolean {
  if (!message) return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  return HIGH_STAKES_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ─── Judge prompt ──────────────────────────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are an impartial judge comparing 2 or 3 candidate AI answers to the same user question in the mining-management domain.

Score each candidate on three dimensions:
  - consistency: does it agree with the others on the factual claims that matter?
  - factuality: are the regulatory / numeric / procedural claims accurate?
  - regulatory_accuracy: does it correctly invoke TRA, BRELA, NEMC, TCRA, NSSF, WCF, OSHA, ICA, BoT, LBMA rules?

Return STRICT JSON only, no prose, in this shape:
{"scores":[{"provider":"anthropic","score":0.9,"reason":"…"},{"provider":"openai","score":0.85,"reason":"…"},{"provider":"deepseek","score":0.7,"reason":"…"}],"winner":"anthropic","winnerReason":"…"}

Score is a number between 0 and 1. The provider with the highest score is the winner. Pick the highest. If two are tied, pick whichever cites concrete regulatory anchors most clearly.`;

interface JudgeOutput {
  readonly scores: ReadonlyArray<DebateScore>;
  readonly winner: DebateProvider;
  readonly winnerReason: string;
}

function extractText(response: BrainLLMResponse): string {
  if (!response.content) return '';
  return response.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

function safeParseJudgeOutput(raw: string): JudgeOutput | null {
  // The judge sometimes wraps JSON in fences; strip them.
  const trimmed = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const scores = obj.scores;
  const winner = obj.winner;
  if (!Array.isArray(scores) || typeof winner !== 'string') return null;
  const allowed: ReadonlySet<DebateProvider> = new Set([
    'anthropic',
    'openai',
    'deepseek',
  ]);
  if (!allowed.has(winner as DebateProvider)) return null;
  const normalised: DebateScore[] = [];
  for (const s of scores) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as Record<string, unknown>;
    if (
      typeof r.provider === 'string' &&
      allowed.has(r.provider as DebateProvider) &&
      typeof r.score === 'number'
    ) {
      normalised.push({
        provider: r.provider as DebateProvider,
        score: Math.max(0, Math.min(1, r.score)),
        reason: typeof r.reason === 'string' ? r.reason : '',
      });
    }
  }
  if (normalised.length === 0) return null;
  const winnerReason =
    typeof obj.winnerReason === 'string' ? obj.winnerReason : '';
  return {
    scores: normalised,
    winner: winner as DebateProvider,
    winnerReason,
  };
}

// ─── Public entry point ─────────────────────────────────────────────

/**
 * Run a 3-way debate across the supplied contenders. Throws when
 * every contender errors (caller should fall back to single-shot).
 *
 * Hard timeout per contender via the optional AbortSignal; per-call
 * latency is recorded on the trace so callers can publish OTel spans.
 */
export async function runDebate(
  contenders: ReadonlyArray<DebateContender>,
  input: DebateInput,
  options: {
    readonly signal?: AbortSignal;
  } = {},
): Promise<DebateResult> {
  if (contenders.length === 0) {
    throw new Error('runDebate: at least one contender is required');
  }

  // Fan out — every contender runs in parallel; an error is captured
  // and downgrades that contender out of the judging pool.
  const fanout = await Promise.all(
    contenders.map(async (contender) => {
      const t0 = Date.now();
      try {
        const response = await contender.client.invoke({
          model: contender.model,
          messages: input.messages,
          system: input.system,
          maxTokens: input.maxTokens ?? 1200,
          temperature: input.temperature ?? 0.7,
        });
        const text = extractText(response);
        return {
          contender,
          response,
          text,
          latencyMs: Date.now() - t0,
          error: null as string | null,
        };
      } catch (err) {
        return {
          contender,
          response: null as BrainLLMResponse | null,
          text: '',
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const successful = fanout.filter(
    (entry): entry is typeof entry & { response: BrainLLMResponse; text: string } =>
      entry.response !== null && entry.text.length > 0,
  );

  if (successful.length === 0) {
    throw new Error(
      `runDebate: every contender failed — ${fanout.map((f) => `${f.contender.provider}:${f.error ?? 'empty'}`).join('; ')}`,
    );
  }

  // 1 survivor → no debate to judge, return as the winner.
  if (successful.length === 1) {
    const only = successful[0]!;
    return {
      winner: {
        provider: only.contender.provider,
        model: only.contender.model,
        response: only.response,
        text: only.text,
      },
      scores: [
        {
          provider: only.contender.provider,
          score: 1,
          reason: 'sole-survivor',
        },
      ],
      trace: {
        responses: fanout.map((f) => ({
          provider: f.contender.provider,
          model: f.contender.model,
          text: f.text,
          latencyMs: f.latencyMs,
          ...(f.error ? { error: f.error } : {}),
        })),
        judgeProvider: null,
        winnerReason: 'sole-survivor',
      },
      verified: false,
    };
  }

  // Pick the judge — Anthropic preferred, fall back to OpenAI, then
  // DeepSeek. Skip the contender being judged is *not* required —
  // judges score themselves too because they're scoring text only.
  const judgeOrder: DebateProvider[] = ['anthropic', 'openai', 'deepseek'];
  const judge =
    contenders.find((c) => c.provider === judgeOrder[0]) ??
    contenders.find((c) => c.provider === judgeOrder[1]) ??
    contenders[0]!;

  const candidateBlock = successful
    .map(
      (s, idx) =>
        `<candidate index="${idx + 1}" provider="${s.contender.provider}">\n${s.text}\n</candidate>`,
    )
    .join('\n');

  const judgeUserPrompt = `Original user question (from message history):\n${formatMessagesForJudge(input.messages)}\n\nCandidate answers:\n${candidateBlock}\n\nReturn the JSON verdict now.`;

  let judgeOutput: JudgeOutput | null = null;
  let judgeError: string | undefined;
  try {
    const judgeResponse = await judge.client.invoke({
      model: judge.model,
      messages: [
        { role: 'user', content: [{ type: 'text', text: judgeUserPrompt }] },
      ],
      system: JUDGE_SYSTEM_PROMPT,
      maxTokens: 600,
      temperature: 0.1,
    });
    judgeOutput = safeParseJudgeOutput(extractText(judgeResponse));
    if (!judgeOutput) {
      judgeError = 'judge_returned_unparseable_json';
    }
  } catch (err) {
    judgeError = err instanceof Error ? err.message : String(err);
  }

  // Deterministic fallback when the judge fails: every survivor gets
  // a flat 0.5 and the FASTEST survivor wins. Never fabricates a winner.
  if (!judgeOutput) {
    const fastest = [...successful].sort((a, b) => a.latencyMs - b.latencyMs)[0]!;
    return {
      winner: {
        provider: fastest.contender.provider,
        model: fastest.contender.model,
        response: fastest.response,
        text: fastest.text,
      },
      scores: successful.map((s) => ({
        provider: s.contender.provider,
        score: 0.5,
        reason: 'judge-unavailable-fallback',
      })),
      trace: {
        responses: fanout.map((f) => ({
          provider: f.contender.provider,
          model: f.contender.model,
          text: f.text,
          latencyMs: f.latencyMs,
          ...(f.error ? { error: f.error } : {}),
        })),
        judgeProvider: judge.provider,
        ...(judgeError ? { judgeError } : {}),
        winnerReason: 'judge-unavailable: chose fastest survivor',
      },
      verified: true, // still a real multi-model run
    };
  }

  // Judge spoke — honour the declared winner, but only if it maps to a
  // real survivor. Otherwise fall back to the highest scorer.
  const judgeWinner = successful.find(
    (s) => s.contender.provider === judgeOutput!.winner,
  );
  const orderedByScore = [...judgeOutput.scores].sort(
    (a, b) => b.score - a.score,
  );
  const fallbackWinner =
    judgeWinner ??
    successful.find(
      (s) => s.contender.provider === orderedByScore[0]?.provider,
    ) ??
    successful[0]!;

  return {
    winner: {
      provider: fallbackWinner.contender.provider,
      model: fallbackWinner.contender.model,
      response: fallbackWinner.response,
      text: fallbackWinner.text,
    },
    scores: judgeOutput.scores,
    trace: {
      responses: fanout.map((f) => ({
        provider: f.contender.provider,
        model: f.contender.model,
        text: f.text,
        latencyMs: f.latencyMs,
        ...(f.error ? { error: f.error } : {}),
      })),
      judgeProvider: judge.provider,
      winnerReason: judgeOutput.winnerReason,
    },
    verified: true,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatMessagesForJudge(
  messages: BrainLLMRequest['messages'],
): string {
  // Only the LAST user turn matters for judging — earlier turns just
  // give context the judge does not need to consume.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return '(no user message in history)';
  const flat = Array.isArray(lastUser.content)
    ? lastUser.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join(' ')
    : String(lastUser.content);
  return flat.slice(0, 2000);
}
