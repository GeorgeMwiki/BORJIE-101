/**
 * REDESIGN stage primitive — LLM-driven optimisation proposal.
 *
 * Renders the ProcessGraph as a compact textual brief, hands it to
 * the injected LLM port, and parses the response. The parser is
 * permissive: it accepts a JSON envelope or a numbered Markdown list,
 * because dev-time LLMs vary in compliance.
 *
 * The result is a RedesignProposal — never executed automatically.
 * The MD's policy gate decides whether to AUTOMATE it.
 */

import type {
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  SubMdContext,
} from './sub-md-base.js';

export interface RedesignStageArgs {
  readonly graph: ProcessGraph;
  readonly ctx: SubMdContext;
  readonly system: string;
  readonly fallbackPrediction: PredictedOutcome;
}

interface RawProposalStep {
  readonly id: string;
  readonly description: string;
  readonly expectedImpact: string;
}

interface RawProposal {
  readonly summary: string;
  readonly steps: ReadonlyArray<RawProposalStep>;
  readonly predicted?: PredictedOutcome;
}

export async function runRedesignStage(args: RedesignStageArgs): Promise<RedesignProposal> {
  const { graph, ctx, system, fallbackPrediction } = args;
  const userBrief = renderGraphBrief(graph);
  const out = await ctx.llm.generate({
    system,
    user: userBrief,
    maxTokens: 800,
  });
  const parsed = parseProposal(out.text);
  return Object.freeze({
    summary: parsed.summary,
    steps: Object.freeze(parsed.steps.slice()),
    predicted: parsed.predicted ?? fallbackPrediction,
  });
}

function renderGraphBrief(graph: ProcessGraph): string {
  const lines: string[] = [];
  lines.push(`Process graph (${graph.observationCount} events observed):`);
  lines.push('Nodes:');
  for (const n of graph.nodes.slice(0, 25)) {
    lines.push(`  - ${n.id} (count=${n.count}${n.avgDwellMs !== undefined ? `, avgDwell=${n.avgDwellMs}ms` : ''})`);
  }
  lines.push('Edges:');
  for (const e of graph.edges.slice(0, 50)) {
    lines.push(`  - ${e.from} -> ${e.to} (count=${e.count}${e.avgTransitionMs !== undefined ? `, avgTransition=${e.avgTransitionMs}ms` : ''})`);
  }
  if (graph.slaBreaches.length > 0) {
    lines.push('SLA breaches:');
    for (const b of graph.slaBreaches) {
      lines.push(`  - ${b.nodeId}: ${b.breachedCount}`);
    }
  }
  lines.push('');
  lines.push('Propose 1-3 reversible redesign steps. Return JSON: {"summary":"...","steps":[{"id":"...","description":"...","expectedImpact":"..."}],"predicted":{"metric":"...","value":N,"unit":"..."}}');
  return lines.join('\n');
}

function parseProposal(text: string): RawProposal {
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const candidate = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (candidate && typeof candidate === 'object' && Array.isArray(candidate.steps)) {
        const steps: RawProposalStep[] = candidate.steps
          .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map((s: Record<string, unknown>, idx: number) => ({
            id: typeof s['id'] === 'string' ? s['id'] : `step-${idx + 1}`,
            description: typeof s['description'] === 'string' ? s['description'] : '',
            expectedImpact: typeof s['expectedImpact'] === 'string' ? s['expectedImpact'] : '',
          }));
        const predicted =
          candidate.predicted && typeof candidate.predicted === 'object'
            ? {
                metric: String(candidate.predicted.metric ?? 'unknown'),
                value: Number(candidate.predicted.value ?? 0),
                unit: String(candidate.predicted.unit ?? '%'),
              }
            : undefined;
        return {
          summary: typeof candidate.summary === 'string' ? candidate.summary : 'redesign',
          steps,
          ...(predicted ? { predicted } : {}),
        };
      }
    } catch {
      // fall through
    }
  }
  return {
    summary: text.slice(0, 200).trim() || 'redesign',
    steps: [],
  };
}
