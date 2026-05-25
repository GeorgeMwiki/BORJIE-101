/**
 * Markdown renderer for capability cards.
 *
 * Produces a clean, deterministic markdown document the admin API can
 * serve at `/api/v1/admin/jarvis/capability-cards/{personaId}`. Output
 * is intentionally simple: H1 + summary + three sections (Can do /
 * Will refuse / Uncertain about) + an optional eval-summary footer.
 */

import type { CapabilityCard } from './capability-cards.js';

export function renderCapabilityCardMarkdown(card: CapabilityCard): string {
  const lines: string[] = [];

  lines.push(`# ${card.personaDisplayName} — Capability Card`);
  lines.push('');
  lines.push(`**Persona id:** \`${card.personaId}\``);
  lines.push('');
  lines.push(card.summary);
  lines.push('');

  // ── Can do ─────────────────────────────────────────────────────────
  lines.push('## Can do');
  lines.push('');
  for (const claim of card.canDo) {
    const conf = renderConfidence(claim.confidence);
    lines.push(`- **${claim.description}** ${conf}`);
    lines.push(`  - id: \`${claim.id}\``);
    lines.push(`  - evidence: \`${claim.evidence}\``);
  }
  lines.push('');

  // ── Will refuse ───────────────────────────────────────────────────
  lines.push('## Will refuse');
  lines.push('');
  for (const refusal of card.willRefuse) {
    lines.push(`- **${refusal.description}** _(category: ${refusal.category})_`);
    lines.push(`  - id: \`${refusal.id}\``);
    lines.push(`  - evidence: \`${refusal.evidence}\``);
  }
  lines.push('');

  // ── Uncertain about ───────────────────────────────────────────────
  lines.push('## Uncertain about');
  lines.push('');
  for (const u of card.uncertainAbout) {
    lines.push(`- **${u.description}**`);
    lines.push(`  - id: \`${u.id}\``);
    lines.push(`  - mitigation: ${u.mitigation}`);
  }
  lines.push('');

  // ── Eval summary (optional) ───────────────────────────────────────
  if (card.evalSummary && card.measuredOnEvalAt) {
    lines.push('## Eval summary');
    lines.push('');
    lines.push(`_Measured on: ${card.measuredOnEvalAt}_`);
    lines.push('');
    lines.push(`- Total scenarios: ${card.evalSummary.totalScenarios}`);
    lines.push(
      `- Mean confidence: ${(card.evalSummary.meanConfidence * 100).toFixed(1)}%`,
    );
    lines.push(
      `- Refusal rate: ${(card.evalSummary.refusalRate * 100).toFixed(1)}%`,
    );
    lines.push(
      `- Drift rate: ${(card.evalSummary.driftRate * 100).toFixed(1)}%`,
    );
    lines.push('');
  }

  return lines.join('\n');
}

function renderConfidence(
  confidence: 'measured' | 'asserted' | 'untested',
): string {
  switch (confidence) {
    case 'measured':
      return '_(measured)_';
    case 'asserted':
      return '_(asserted)_';
    case 'untested':
      return '_(untested)_';
  }
}
