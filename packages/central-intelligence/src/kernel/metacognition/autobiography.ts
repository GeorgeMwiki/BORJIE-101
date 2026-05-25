/**
 * Autobiography — periodic summary of the agent's recent decisions.
 *
 * The autobiography is the agent's self-model in narrative form:
 * "Over the past N turns I have answered M questions, refused R,
 * and softened S. My most common topic was T. I was most confident
 * on C and least confident on L."
 *
 * Generated periodically (every 25 turns by default, or once per
 * day, whichever comes first) and persisted into the core-memory
 * 'persona' block. The autobiography is what makes the agent feel
 * like the SAME agent across sessions, not a fresh-start chatbot.
 *
 * Pure aggregator over decision-trace summaries — no LLM call. A
 * downstream embellisher can rewrite it in the persona's voice.
 */

export interface AutobiographyDecisionRecord {
  readonly thoughtId: string;
  readonly outcome: 'answer' | 'softened' | 'refusal';
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly confidence: number;
  readonly topic?: string;
  readonly capturedAt: string;
}

export interface AutobiographyArgs {
  readonly personaId: string;
  readonly windowDecisions: ReadonlyArray<AutobiographyDecisionRecord>;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface Autobiography {
  readonly personaId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly totals: {
    readonly answers: number;
    readonly softened: number;
    readonly refusals: number;
    readonly criticalTurns: number;
  };
  readonly avgConfidence: number;
  readonly mostFrequentTopic: string | null;
  readonly highConfidenceTopic: string | null;
  readonly lowConfidenceTopic: string | null;
  /** Rendered narrative fragment. */
  readonly narrative: string;
}

const MIN_WINDOW_DECISIONS = 3;

export function generateAutobiography(
  args: AutobiographyArgs,
): Autobiography {
  const decisions = args.windowDecisions ?? [];

  const totals = {
    answers: decisions.filter((d) => d.outcome === 'answer').length,
    softened: decisions.filter((d) => d.outcome === 'softened').length,
    refusals: decisions.filter((d) => d.outcome === 'refusal').length,
    criticalTurns: decisions.filter((d) => d.stakes === 'critical').length,
  };

  const avgConfidence =
    decisions.length > 0
      ? decisions.reduce((s, d) => s + (d.confidence ?? 0), 0) /
        decisions.length
      : 0;

  // Topic histogram + per-topic confidence accumulator.
  const topicHist = new Map<string, { count: number; confSum: number }>();
  for (const d of decisions) {
    if (!d.topic) continue;
    const existing = topicHist.get(d.topic) ?? { count: 0, confSum: 0 };
    topicHist.set(d.topic, {
      count: existing.count + 1,
      confSum: existing.confSum + (d.confidence ?? 0),
    });
  }

  let mostFrequentTopic: string | null = null;
  let bestCount = 0;
  let highConfTopic: string | null = null;
  let highConfAvg = 0;
  let lowConfTopic: string | null = null;
  let lowConfAvg = 1;
  for (const [topic, agg] of topicHist) {
    if (agg.count > bestCount) {
      bestCount = agg.count;
      mostFrequentTopic = topic;
    }
    const avg = agg.count > 0 ? agg.confSum / agg.count : 0;
    if (avg > highConfAvg) {
      highConfAvg = avg;
      highConfTopic = topic;
    }
    if (avg < lowConfAvg) {
      lowConfAvg = avg;
      lowConfTopic = topic;
    }
  }

  const narrative =
    decisions.length < MIN_WINDOW_DECISIONS
      ? `Not enough decisions in the window (${decisions.length}) to write an autobiography.`
      : buildNarrative({
          personaId: args.personaId,
          totals,
          avgConfidence,
          mostFrequentTopic,
          highConfidenceTopic: highConfTopic,
          lowConfidenceTopic: lowConfTopic,
        });

  return {
    personaId: args.personaId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    totals,
    avgConfidence,
    mostFrequentTopic,
    highConfidenceTopic: highConfTopic,
    lowConfidenceTopic: lowConfTopic,
    narrative,
  };
}

function buildNarrative(args: {
  readonly personaId: string;
  readonly totals: Autobiography['totals'];
  readonly avgConfidence: number;
  readonly mostFrequentTopic: string | null;
  readonly highConfidenceTopic: string | null;
  readonly lowConfidenceTopic: string | null;
}): string {
  const lines: string[] = [];
  const t = args.totals;
  const total = t.answers + t.softened + t.refusals;
  lines.push(
    `In the past ${total} turns I (${args.personaId}) answered ${t.answers}, softened ${t.softened}, and refused ${t.refusals}.`,
  );
  lines.push(
    `My average confidence was ${args.avgConfidence.toFixed(2)} (1.0 = perfect).`,
  );
  if (t.criticalTurns > 0) {
    lines.push(`${t.criticalTurns} of those turns were critical-stakes.`);
  }
  if (args.mostFrequentTopic) {
    lines.push(`My most common topic was "${args.mostFrequentTopic}".`);
  }
  if (args.highConfidenceTopic && args.lowConfidenceTopic) {
    lines.push(
      `I was most confident on "${args.highConfidenceTopic}" and least confident on "${args.lowConfidenceTopic}".`,
    );
  }
  return lines.join(' ');
}
