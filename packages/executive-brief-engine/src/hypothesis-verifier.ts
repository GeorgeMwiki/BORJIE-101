/**
 * @borjie/executive-brief-engine — hypothesis-verifier.
 *
 * Step 2 of the LLM stack. Takes the top-k hypotheses (by online-judge
 * score) and verifies them by drilling into the org graph + audit trail
 * for supporting evidence. Hypotheses that fail to produce ≥1 fresh
 * citation are rejected.
 *
 * The verifier reuses the existing kernel ToT + LATS primitives via
 * the `ToTLatsPort` — the package does NOT redesign reasoning. It
 * only orchestrates: pass hypothesis → ports → output verified/rejected.
 *
 * Out: a {survivors, rejected} split, each survivor enriched with the
 * citations it earned.
 */

import type { Hypothesis, Severity } from './types.js';
import type { RetrievalHit } from './retrieval.js';
import { hybridRetrieve, type HybridRetrieverDeps } from './retrieval.js';

// ─────────────────────────────────────────────────────────────────────
// Online-judge port — reuses existing kernel sensors/self-grading-judge.
// ─────────────────────────────────────────────────────────────────────

export interface OnlineJudgePort {
  /** Returns a 0..1 score; higher = more credible. */
  score(args: {
    readonly hypothesis: Hypothesis;
    readonly retrievedEvidence: ReadonlyArray<RetrievalHit>;
  }): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// ToT/LATS port — wires to packages/central-intelligence/src/kernel/
// `agency/goals/plan-decomposer.ts` + the LATS evaluator. We expose a
// minimal "verify" surface: given hypothesis + initial evidence, return
// a refined hypothesis (or null when verification fails).
// ─────────────────────────────────────────────────────────────────────

export interface ToTLatsPort {
  verify(args: {
    readonly hypothesis: Hypothesis;
    readonly tenantId: string;
    readonly initialEvidence: ReadonlyArray<RetrievalHit>;
  }): Promise<{
    readonly survives: boolean;
    /** Additional citations the deeper reasoning surfaced. */
    readonly additionalEvidence: ReadonlyArray<RetrievalHit>;
    readonly refinedSeverity?: Severity;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// VerifierDeps — the bundle of ports the verifier needs.
// ─────────────────────────────────────────────────────────────────────

export interface VerifierDeps {
  readonly retrieval: HybridRetrieverDeps;
  readonly judge: OnlineJudgePort;
  readonly totLats: ToTLatsPort;
}

export interface VerifierArgs {
  readonly tenantId: string;
  readonly hypotheses: ReadonlyArray<Hypothesis>;
  /** Verify only the top N (by judge score). Default 10. */
  readonly topN?: number;
  /** Reject hypotheses with judge score below this. Default 0.5. */
  readonly minJudgeScore?: number;
}

export interface VerifiedHypothesis {
  readonly hypothesis: Hypothesis;
  /** Citations earned through retrieval + ToT/LATS. */
  readonly evidence: ReadonlyArray<RetrievalHit>;
  readonly judgeScore: number;
}

export interface VerifierResult {
  readonly survivors: ReadonlyArray<VerifiedHypothesis>;
  readonly rejected: ReadonlyArray<Hypothesis>;
}

// ─────────────────────────────────────────────────────────────────────
// verifyHypotheses — public API.
//
// Steps:
//   1. Score each hypothesis with the online judge over its evidence refs.
//   2. Sort by score desc; keep top N.
//   3. For each survivor:
//      a. Hybrid retrieve more evidence anchored on hypothesis claims.
//      b. ToT/LATS verify.
//      c. If survives AND has ≥1 evidence ref → enter survivors.
//
// Each step degrades gracefully — a failing judge call returns score 0,
// a failing ToT call drops the hypothesis. We never crash the engine.
// ─────────────────────────────────────────────────────────────────────

export async function verifyHypotheses(
  deps: VerifierDeps,
  args: VerifierArgs,
): Promise<VerifierResult> {
  const topN = args.topN ?? 10;
  const minJudgeScore = args.minJudgeScore ?? 0.5;

  if (args.hypotheses.length === 0) {
    return { survivors: [], rejected: [] };
  }

  // Step 1 — score every hypothesis.
  const scored = await Promise.all(
    args.hypotheses.map(async (h) => {
      const initial = await hybridRetrieve(deps.retrieval, {
        tenantId: args.tenantId,
        query: `${h.title}. ${h.description}`,
        anchorEntityIds: h.evidenceRefs
          .filter((e) => e.kind === 'entity')
          .map((e) => e.id),
        k: 8,
      });
      let judgeScore = 0;
      try {
        judgeScore = await deps.judge.score({
          hypothesis: h,
          retrievedEvidence: initial,
        });
      } catch {
        judgeScore = 0;
      }
      return { hypothesis: h, evidence: initial, judgeScore };
    }),
  );

  // Step 2 — sort + slice.
  const ranked = [...scored].sort((a, b) => b.judgeScore - a.judgeScore);
  const candidates = ranked.slice(0, topN);

  // Step 3 — verify each candidate.
  const survivors: VerifiedHypothesis[] = [];
  const rejected: Hypothesis[] = [];

  for (const candidate of candidates) {
    if (candidate.judgeScore < minJudgeScore) {
      rejected.push(candidate.hypothesis);
      continue;
    }
    try {
      const result = await deps.totLats.verify({
        hypothesis: candidate.hypothesis,
        tenantId: args.tenantId,
        initialEvidence: candidate.evidence,
      });
      if (!result.survives) {
        rejected.push(candidate.hypothesis);
        continue;
      }
      const merged = mergeEvidence([...candidate.evidence, ...result.additionalEvidence]);
      if (merged.length === 0) {
        // Uncited hypothesis is non-survivable — we never publish a claim without a citation.
        rejected.push(candidate.hypothesis);
        continue;
      }
      survivors.push({
        hypothesis: applySeverity(candidate.hypothesis, result.refinedSeverity),
        evidence: merged,
        judgeScore: candidate.judgeScore,
      });
    } catch {
      rejected.push(candidate.hypothesis);
    }
  }

  // Anything outside topN is implicitly rejected.
  for (const tail of ranked.slice(topN)) {
    rejected.push(tail.hypothesis);
  }

  return { survivors, rejected };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function applySeverity(h: Hypothesis, refined?: Severity): Hypothesis {
  if (!refined) return h;
  // Immutability — return a new object, never mutate.
  return { ...h, severity: refined };
}

function mergeEvidence(hits: ReadonlyArray<RetrievalHit>): ReadonlyArray<RetrievalHit> {
  const seen = new Set<string>();
  const out: RetrievalHit[] = [];
  for (const h of hits) {
    const key = `${h.kind}:${h.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
