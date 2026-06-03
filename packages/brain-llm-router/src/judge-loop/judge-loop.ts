/**
 * judge-loop — self-judge + regenerate-with-feedback.
 *
 * Ported in spirit from LITFIN `src/core/ai/claude-service.ts` self-judge path.
 * Borjie already has consistency-vote (majorityVote) and CoVe (runCove); this
 * adds the third quality lever: an LLM scores its own draft 0–100 against a
 * rubric, and if the score is below `threshold` the generator is re-run WITH the
 * judge's feedback appended, up to `maxAttempts`. The best-scoring attempt wins.
 *
 * Both collaborators are injected ports — leaf logic imports no client. Pure
 * orchestration; never throws (a failing judge scores 0 + halts the loop with
 * the last good draft).
 */

export interface JudgeVerdict {
  /** Quality score in [0,100]. Clamped on ingest. */
  readonly score: number;
  /** Actionable feedback fed back to the generator on regenerate. */
  readonly feedback: string;
}

/** Port: produce a draft. `feedback` is the prior judge note (empty on first pass). */
export type GeneratePort = (args: {
  readonly prompt: string;
  readonly feedback: string;
  readonly attempt: number;
}) => Promise<string>;

/** Port: score a draft against the prompt. */
export type JudgePort = (args: {
  readonly prompt: string;
  readonly draft: string;
}) => Promise<JudgeVerdict>;

export interface JudgeLoopConfig {
  readonly generate: GeneratePort;
  readonly judge: JudgePort;
  /** Accept-and-stop score [0,100]. Default 80. */
  readonly threshold?: number;
  /** Hard cap on generate calls. Default 3. Always ≥1. */
  readonly maxAttempts?: number;
}

export interface JudgeLoopAttempt {
  readonly draft: string;
  readonly score: number;
  readonly feedback: string;
}

export interface JudgeLoopResult {
  /** Highest-scoring draft seen. */
  readonly output: string;
  /** Its score. */
  readonly score: number;
  /** True when the winning score met the threshold. */
  readonly accepted: boolean;
  /** Every attempt, in order. */
  readonly attempts: readonly JudgeLoopAttempt[];
}

const DEFAULT_THRESHOLD = 80;
const DEFAULT_MAX_ATTEMPTS = 3;

function clampScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Run the self-judge loop. Generates, scores, and — while below threshold and
 * under the attempt cap — regenerates with the judge's feedback. Returns the
 * best attempt.
 *
 * Never throws: a generator/judge rejection ends the loop and returns the best
 * draft so far (or an empty draft scored 0 if the very first generate failed).
 */
export async function runJudgeLoop(prompt: string, config: JudgeLoopConfig): Promise<JudgeLoopResult> {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  const attempts: JudgeLoopAttempt[] = [];
  let feedback = '';
  let best: JudgeLoopAttempt = { draft: '', score: -1, feedback: '' };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let draft: string;
    try {
      draft = await config.generate({ prompt, feedback, attempt });
    } catch {
      break; // generator failed — keep the best we have
    }

    let verdict: JudgeVerdict;
    try {
      verdict = await config.judge({ prompt, draft });
    } catch {
      // Judge failed — accept this draft as-is and stop (cannot score further).
      const rec: JudgeLoopAttempt = { draft, score: 0, feedback: '' };
      attempts.push(rec);
      if (rec.score > best.score) best = rec;
      break;
    }

    const score = clampScore(verdict.score);
    const rec: JudgeLoopAttempt = { draft, score, feedback: verdict.feedback };
    attempts.push(rec);
    if (score > best.score) best = rec;

    if (score >= threshold) break; // good enough — stop early
    feedback = verdict.feedback; // carry forward for the next regenerate
  }

  // If even the first generate failed, best.score is still -1 → normalise to 0.
  const finalScore = best.score < 0 ? 0 : best.score;
  return {
    output: best.draft,
    score: finalScore,
    accepted: finalScore >= threshold,
    attempts,
  };
}
