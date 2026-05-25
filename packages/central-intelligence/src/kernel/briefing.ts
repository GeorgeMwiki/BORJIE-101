/**
 * Briefing — the morning intel the personal Jarvis delivers to its
 * admin. Mirrors LITFIN's head-briefing pattern: a structured digest
 * that prioritises the things the admin needs to know first.
 *
 * Composition strategy: gather a deterministic set of "briefing
 * inputs" from outside (forecasting, audit, vacancy pipeline, work
 * orders) and ask the kernel to render them through the admin's
 * personalised sovereign persona. The briefing function is a
 * provider-agnostic pure orchestrator; data sources are injected.
 */

import type { BrainKernel } from './kernel.js';
import type { BrainDecision, ThoughtRequest } from './kernel-types.js';
import type { ScopeContext } from '../types.js';
import type { UserProfile } from './identity.js';

export interface BriefingDataPoint {
  readonly topic: string;
  readonly summary: string;
  readonly severity: 'info' | 'warn' | 'urgent';
  readonly citationLabel?: string;
}

export interface BriefingInputs {
  readonly day: string;                                 // ISO date
  readonly user: UserProfile;
  readonly scope: ScopeContext;
  readonly threadId: string;
  readonly dataPoints: ReadonlyArray<BriefingDataPoint>;
  readonly topPriority: BriefingDataPoint | null;
}

export interface BriefingComposerDeps {
  readonly kernel: BrainKernel;
}

export interface Briefing {
  readonly day: string;
  readonly headline: string;
  readonly bullets: ReadonlyArray<string>;
  readonly decision: BrainDecision;
}

export function createBriefingComposer(deps: BriefingComposerDeps) {
  return {
    async compose(inputs: BriefingInputs): Promise<Briefing> {
      if (inputs.dataPoints.length === 0) {
        throw new Error('briefing requires at least one data point');
      }

      const userMessage = renderBriefingPrompt(inputs);
      const req: ThoughtRequest = {
        threadId: inputs.threadId,
        userMessage,
        scope: inputs.scope,
        // Briefing for the personal sovereign AI runs at org tier;
        // platform-tier admins explicitly route through the platform
        // sovereign persona instead.
        tier: inputs.scope.kind === 'platform' ? 'industry' : 'org',
        stakes:
          inputs.dataPoints.some((d) => d.severity === 'urgent')
            ? 'high'
            : inputs.dataPoints.some((d) => d.severity === 'warn')
            ? 'medium'
            : 'low',
        surface: 'admin-portal',
        requireJudge: false,
      };

      const decision = await deps.kernel.think(req);
      const text = decision.kind === 'refusal' ? decision.reason : decision.text;
      const headline = inputs.topPriority?.summary ?? firstSentence(text);
      const bullets = inputs.dataPoints.map((d) => `${severityBadge(d.severity)} ${d.summary}`);

      return {
        day: inputs.day,
        headline,
        bullets,
        decision,
      };
    },
  };
}

function renderBriefingPrompt(inputs: BriefingInputs): string {
  const lines: string[] = [];
  lines.push(`Brief me for ${inputs.day}.`);
  lines.push('');
  lines.push('Inputs (each line is a single fact you may use; do not invent):');
  for (const d of inputs.dataPoints) {
    const sev = d.severity.toUpperCase();
    const cite = d.citationLabel ? ` [cite:${d.citationLabel}]` : '';
    lines.push(`  - [${sev}] ${d.topic}: ${d.summary}${cite}`);
  }
  lines.push('');
  lines.push(
    'Style: lead with the single thing I should look at first; then a maximum of 5 bullets. No throat-clearing. No buzzwords. If a fact is missing, say so.',
  );
  return lines.join('\n');
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]+[.!?]/);
  return match ? match[0].trim() : text.slice(0, 120);
}

function severityBadge(s: BriefingDataPoint['severity']): string {
  switch (s) {
    case 'urgent': return 'urgent —';
    case 'warn':   return 'attention —';
    case 'info':   return 'fyi —';
  }
}
