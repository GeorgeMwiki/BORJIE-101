/**
 * Brain-context projector (thin, read-only wire).
 *
 * Projects a `StandingBrief` into the compact, prompt-ready shape the
 * brain reads FIRST each turn — the re-orientation ritual: read state →
 * highest-priority undone item → verify-before-work.
 *
 * READ-ONLY: it transforms an already-built brief; it never fetches,
 * mutates, or gates. The host calls `buildStandingBrief` (ports) then
 * `briefForBrainContext` and injects the result into the brain's context
 * window — additive, alongside the existing context, never replacing it.
 *
 * Kept deliberately small + deterministic so it is cheap to call every
 * turn and trivially testable.
 */
import type { StandingBrief } from './brief-types.js';

export interface BrainContextProjection {
  readonly tenantId: string | null;
  readonly builtAt: string;
  /** Compact prompt block — the six facets as terse, evidence-tagged lines. */
  readonly promptBlock: string;
  /** The one item to re-orient to first (or null). */
  readonly nextBestActionSummary: string | null;
  /** TRUE if any caveat demands abstention — the brain should clarify. */
  readonly mustClarify: boolean;
  /** Count of open blind spots (gaps the brain must not bluff over). */
  readonly openBlindSpots: number;
}

/**
 * Project the brief for the brain's context window.
 */
export function briefForBrainContext(
  brief: StandingBrief,
): BrainContextProjection {
  const mustClarify = brief.caveats.some((c) => c.abstain);

  return {
    tenantId: brief.tenantId,
    builtAt: brief.builtAt,
    promptBlock: renderPromptBlock(brief),
    nextBestActionSummary: brief.nextBestAction?.summary ?? null,
    mustClarify,
    openBlindSpots: brief.blindSpots.length,
  };
}

function renderPromptBlock(brief: StandingBrief): string {
  const lines: string[] = ['## Standing brief (read first)'];

  appendFacet(lines, 'HAPPENED', brief.happened.map((i) => i.summary));
  appendFacet(lines, 'DOING', brief.doing.map((i) => i.summary));
  appendFacet(lines, 'TO DO', brief.toDo.map((i) => i.summary));
  appendFacet(
    lines,
    'COULD MATTER LATER',
    brief.couldMatterLater.map((i) => `${i.summary} (${i.daysUntil}d)`),
  );
  appendFacet(
    lines,
    'BLIND SPOTS',
    brief.blindSpots.map((b) => `${b.summary} — blocks: ${b.blocksDecision}`),
  );
  appendFacet(
    lines,
    'CAVEATS',
    brief.caveats.map((c) => `${c.note}${c.abstain ? ' [ABSTAIN]' : ''}`),
  );

  if (brief.nextBestAction) {
    lines.push('');
    lines.push(`NEXT BEST ACTION: ${brief.nextBestAction.summary}`);
  }

  return lines.join('\n');
}

function appendFacet(
  lines: string[],
  label: string,
  items: ReadonlyArray<string>,
): void {
  if (items.length === 0) {
    lines.push(`- ${label}: (none)`);
    return;
  }
  lines.push(`- ${label}:`);
  for (const item of items) {
    lines.push(`  - ${item}`);
  }
}
