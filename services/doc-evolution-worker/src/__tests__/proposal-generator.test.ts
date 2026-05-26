/**
 * proposal-generator.test — covers prompt building + the schema-strict
 * parsing of the LLM response.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  generateProposal,
  type ProposalLlmPort,
} from '../decisions/proposal-generator.js';
import type { RecipeFitnessStats } from '../types.js';

const baseStats = (
  overrides: Partial<RecipeFitnessStats> = {},
): RecipeFitnessStats => ({
  recipe_id: overrides.recipe_id ?? 'tumemadini_monthly_return',
  recipe_version: overrides.recipe_version ?? 1,
  tenant_id: overrides.tenant_id ?? 't1',
  window_start_iso: '2026-03-01T00:00:00Z',
  window_end_iso: '2026-05-01T00:00:00Z',
  composition_count: overrides.composition_count ?? 10,
  first_submit_acceptance_rate: overrides.first_submit_acceptance_rate ?? 0.4,
  revision_rate: overrides.revision_rate ?? 0.4,
  regulator_flag_count: overrides.regulator_flag_count ?? 0,
  owner_rewrite_count: overrides.owner_rewrite_count ?? 0,
  avg_time_to_approve_seconds: overrides.avg_time_to_approve_seconds ?? null,
  section_revision_rates: overrides.section_revision_rates ?? [
    { section_path: 'section.assays', revision_rate: 0.3, revision_count: 3 },
  ],
});

describe('buildPrompt', () => {
  it('lists targeted sections, narratives and citations', () => {
    const prompt = buildPrompt({
      recipe_id: 'tumemadini_monthly_return',
      current_version: 1,
      stats: baseStats(),
      recent_narratives: [
        {
          section_path: 'section.assays',
          note: 'inspector wanted exact ppm not %',
          recorded_at: '2026-04-01T10:00:00Z',
        },
      ],
      corpus_citations: ['statute:tumemadini.return.s5.2'],
    });
    expect(prompt).toContain('tumemadini_monthly_return');
    expect(prompt).toContain('section.assays');
    expect(prompt).toContain('inspector wanted exact ppm not %');
    expect(prompt).toContain('statute:tumemadini.return.s5.2');
    expect(prompt).toContain('Respond with ONLY the JSON');
  });

  it('renders empty placeholders gracefully', () => {
    const prompt = buildPrompt({
      recipe_id: 'r1',
      current_version: 2,
      stats: baseStats({ section_revision_rates: [] }),
      recent_narratives: [],
      corpus_citations: [],
    });
    expect(prompt).toContain('- (none)');
  });
});

describe('generateProposal', () => {
  const validInput = {
    recipe_id: 'tumemadini_monthly_return',
    current_version: 1,
    stats: baseStats(),
    recent_narratives: [],
    corpus_citations: ['statute:s5.2'],
  };

  const validResponse = {
    recipe_id: 'tumemadini_monthly_return',
    current_version: 1,
    proposed_version: 2,
    summary: 'Reword assays section to use ppm units per statute s5.2.',
    edits: [
      {
        kind: 'rewrite',
        section_path: 'section.assays',
        rationale: 'statute:s5.2 mandates ppm not percent for Au.',
        proposed_text: 'The Au content shall be reported in parts per million.',
      },
    ],
  };

  it('parses a valid JSON response into a typed ProposedDiff', async () => {
    const llm: ProposalLlmPort = {
      async generate() {
        return JSON.stringify(validResponse);
      },
    };
    const diff = await generateProposal(llm, validInput);
    expect(diff.proposed_version).toBe(2);
    expect(diff.edits[0]?.section_path).toBe('section.assays');
  });

  it('strips ```json fences from the response', async () => {
    const llm: ProposalLlmPort = {
      async generate() {
        return '```json\n' + JSON.stringify(validResponse) + '\n```';
      },
    };
    const diff = await generateProposal(llm, validInput);
    expect(diff.proposed_version).toBe(2);
  });

  it('throws on non-JSON', async () => {
    const llm: ProposalLlmPort = {
      async generate() {
        return 'this is prose not json';
      },
    };
    await expect(generateProposal(llm, validInput)).rejects.toThrow(
      /non-JSON/,
    );
  });

  it('throws on schema violation', async () => {
    const llm: ProposalLlmPort = {
      async generate() {
        return JSON.stringify({
          ...validResponse,
          edits: [],
        });
      },
    };
    await expect(generateProposal(llm, validInput)).rejects.toThrow(
      /schema/,
    );
  });

  it('throws when proposed_version != current+1', async () => {
    const llm: ProposalLlmPort = {
      async generate() {
        return JSON.stringify({
          ...validResponse,
          proposed_version: 5,
        });
      },
    };
    await expect(generateProposal(llm, validInput)).rejects.toThrow(
      /current\+1/,
    );
  });
});
