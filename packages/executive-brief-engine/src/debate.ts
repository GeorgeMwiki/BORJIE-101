/**
 * @borjie/executive-brief-engine — debate orchestration.
 *
 * For high-stakes hypotheses (severity HIGH or CRITICAL), invoke the
 * existing three-voice debate from
 * `packages/central-intelligence/src/kernel/debate/`. The package
 * exposes the debate as a port — we never reimplement the debate
 * runner itself.
 *
 * If the three voices disagree on whether to keep a finding, the
 * debate port escalates to Sonnet (the runner internally calls a
 * stronger model for synthesis). The result lands here as a
 * single verdict + synthesised commentary.
 *
 * We DO NOT escalate every hypothesis — only HIGH and CRITICAL —
 * because debate burns ~3-5x the tokens of a single sensor call.
 */

import type { VerifiedHypothesis } from './hypothesis-verifier.js';
import type { Severity } from './types.js';

// ─────────────────────────────────────────────────────────────────────
// DebatePort — wraps `runStakesAwareDebate` from central-intelligence/
// kernel/debate. The api-gateway composition provides the adapter.
// ─────────────────────────────────────────────────────────────────────

export interface DebatePort {
  debate(args: {
    readonly tenantId: string;
    readonly question: string;
    readonly verifiedHypothesis: VerifiedHypothesis;
    readonly stakes: 'HIGH' | 'CRITICAL';
  }): Promise<{
    readonly verdict: 'keep' | 'drop' | 'soften';
    /** Synthesised note from the debate runner. Empty when the runner has nothing to add. */
    readonly synthesisedNote: string;
    /** When verdict='soften', the severity to downgrade to. */
    readonly softenedSeverity?: Severity;
    readonly tokenCostMicros: number;
  }>;
}

export interface DebateArgs {
  readonly tenantId: string;
  readonly survivors: ReadonlyArray<VerifiedHypothesis>;
  readonly debatePort: DebatePort;
  /** Stakes threshold above which we trigger debate. Default HIGH. */
  readonly stakesThreshold?: Exclude<Severity, 'LOW' | 'MEDIUM'>;
}

export interface DebatedHypothesis extends VerifiedHypothesis {
  readonly debateNote?: string;
}

export interface DebateResult {
  readonly survivors: ReadonlyArray<DebatedHypothesis>;
  readonly dropped: ReadonlyArray<VerifiedHypothesis>;
  readonly totalCostMicros: number;
}

// ─────────────────────────────────────────────────────────────────────
// runStakesAwareDebate — public API.
//
// For each survivor at or above the threshold severity, call the
// debate port. The verdict either keeps, softens, or drops the
// hypothesis.
// ─────────────────────────────────────────────────────────────────────

export async function runStakesAwareDebateOnBrief(
  args: DebateArgs,
): Promise<DebateResult> {
  const threshold = args.stakesThreshold ?? 'HIGH';
  const stakesOrder: Record<Severity, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  const minRank = stakesOrder[threshold];

  const survivors: DebatedHypothesis[] = [];
  const dropped: VerifiedHypothesis[] = [];
  let totalCostMicros = 0;

  for (const verified of args.survivors) {
    const rank = stakesOrder[verified.hypothesis.severity];
    if (rank < minRank) {
      // Below threshold — keep as-is, no debate.
      survivors.push(verified);
      continue;
    }
    let stakes: 'HIGH' | 'CRITICAL' = 'HIGH';
    if (verified.hypothesis.severity === 'CRITICAL') stakes = 'CRITICAL';

    try {
      const outcome = await args.debatePort.debate({
        tenantId: args.tenantId,
        question: `Should we publish this ${verified.hypothesis.kind} to the executive: "${verified.hypothesis.title}"?`,
        verifiedHypothesis: verified,
        stakes,
      });
      totalCostMicros += outcome.tokenCostMicros;

      switch (outcome.verdict) {
        case 'keep':
          survivors.push({
            ...verified,
            ...(outcome.synthesisedNote ? { debateNote: outcome.synthesisedNote } : {}),
          });
          break;
        case 'soften': {
          const newSeverity: Severity = outcome.softenedSeverity ?? 'MEDIUM';
          survivors.push({
            ...verified,
            hypothesis: { ...verified.hypothesis, severity: newSeverity },
            ...(outcome.synthesisedNote ? { debateNote: outcome.synthesisedNote } : {}),
          });
          break;
        }
        case 'drop':
        default:
          dropped.push(verified);
          break;
      }
    } catch {
      // Debate failure → conservative behaviour: keep but mark debateNote.
      survivors.push({
        ...verified,
        debateNote: 'Debate runner unavailable; published without escalation.',
      });
    }
  }

  return { survivors, dropped, totalCostMicros };
}
