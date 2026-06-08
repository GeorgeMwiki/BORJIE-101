/**
 * Brain-context projector tests — the read-only re-orientation wire.
 */
import { describe, expect, it } from 'vitest';
import { briefForBrainContext } from '../brain-context.js';
import { buildStandingBrief, type BuildBriefContext } from '../standing-brief.js';
import type { BriefSources } from '../brief-ports.js';

const NOW = new Date('2026-06-08T12:00:00Z');
const ctx: BuildBriefContext = { now: () => NOW };

const sources: BriefSources = {
  toDo: async () => [
    {
      id: 't1',
      summary: 'File TRA royalty return',
      state: 'pending',
      importance: 9,
      dueAt: new Date(NOW.getTime() + 2 * 86400000).toISOString(),
      evidenceKind: 'workflow',
      evidenceId: 'wf:tra',
    },
  ],
  blindSpots: async () => [
    {
      id: 'b1',
      summary: 'No recent assay for Pit 3',
      blocksDecision: 'offtake pricing',
      resolutionHint: 'commission an assay',
      importance: 8,
      evidenceKind: 'signal',
      evidenceId: 'signal:gap',
    },
  ],
};

describe('briefForBrainContext', () => {
  it('renders a compact prompt block with all six facet labels', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const proj = briefForBrainContext(brief);
    expect(proj.promptBlock).toContain('Standing brief (read first)');
    expect(proj.promptBlock).toContain('HAPPENED');
    expect(proj.promptBlock).toContain('DOING');
    expect(proj.promptBlock).toContain('TO DO');
    expect(proj.promptBlock).toContain('COULD MATTER LATER');
    expect(proj.promptBlock).toContain('BLIND SPOTS');
    expect(proj.promptBlock).toContain('CAVEATS');
  });

  it('surfaces the next-best-action summary', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const proj = briefForBrainContext(brief);
    expect(proj.nextBestActionSummary).toBe('File TRA royalty return');
    expect(proj.promptBlock).toContain('NEXT BEST ACTION');
  });

  it('sets mustClarify when an abstain caveat is present', async () => {
    const brief = await buildStandingBrief('tenant_a', sources, ctx);
    const proj = briefForBrainContext(brief);
    expect(proj.mustClarify).toBe(true);
    expect(proj.openBlindSpots).toBe(1);
  });

  it('clears mustClarify when no blind spots / abstain caveats', async () => {
    const brief = await buildStandingBrief(
      'tenant_a',
      { toDo: sources.toDo },
      ctx,
    );
    const proj = briefForBrainContext(brief);
    expect(proj.mustClarify).toBe(false);
    expect(proj.openBlindSpots).toBe(0);
  });

  it('renders (none) for empty facets', async () => {
    const brief = await buildStandingBrief('tenant_a', {}, ctx);
    const proj = briefForBrainContext(brief);
    expect(proj.promptBlock).toContain('HAPPENED: (none)');
    expect(proj.nextBestActionSummary).toBeNull();
  });
});
