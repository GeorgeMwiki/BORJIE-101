/**
 * proposal-validator.test — brand-lint + section-coherence rules.
 */

import { describe, it, expect } from 'vitest';
import {
  validateProposal,
  lintProposalText,
} from '../decisions/proposal-validator.js';
import type { ProposedDiff } from '../types.js';

const baseDiff = (overrides: Partial<ProposedDiff> = {}): ProposedDiff => ({
  recipe_id: overrides.recipe_id ?? 'r1',
  current_version: overrides.current_version ?? 1,
  proposed_version: overrides.proposed_version ?? 2,
  summary: overrides.summary ?? 'Improve assays.',
  edits: overrides.edits ?? [
    {
      kind: 'rewrite',
      section_path: 'section.assays',
      rationale: 'reg s5.2 mandates ppm',
      proposed_text: 'Report Au in ppm.',
    },
  ],
});

describe('validateProposal', () => {
  it('accepts a well-formed proposal', () => {
    const result = validateProposal({
      diff: baseDiff(),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses empty edits', () => {
    const result = validateProposal({
      diff: baseDiff({ edits: [] }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContain('empty_edits');
    }
  });

  it('refuses non-monotonic versions', () => {
    const result = validateProposal({
      diff: baseDiff({ current_version: 5, proposed_version: 3 }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) => v.startsWith('non_monotonic_version')),
      ).toBe(true);
    }
  });

  it('refuses an edit referencing an unknown section', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'rewrite',
            section_path: 'section.who_dis',
            rationale: 'r',
            proposed_text: 'Foo.',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.startsWith('unknown_section_for_rewrite:section.who_dis'),
        ),
      ).toBe(true);
    }
  });

  it('refuses an add_section that already exists', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'add_section',
            section_path: 'section.assays',
            rationale: 'r',
            proposed_text: 'Foo.',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.startsWith('duplicate_add_section'),
        ),
      ).toBe(true);
    }
  });

  it('refuses add_citation without citation_ref', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'add_citation',
            section_path: 'section.assays',
            rationale: 'r',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: ['statute:s5'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.startsWith('add_citation_missing_ref'),
        ),
      ).toBe(true);
    }
  });

  it('refuses reorder without proposed_position', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'reorder',
            section_path: 'section.assays',
            rationale: 'r',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.startsWith('reorder_missing_position'),
        ),
      ).toBe(true);
    }
  });

  it('refuses citation_ref not in the available set', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'add_citation',
            section_path: 'section.assays',
            rationale: 'r',
            citation_ref: 'unknown:1',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: ['statute:s5'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) =>
          v.startsWith('citation_ref_not_available'),
        ),
      ).toBe(true);
    }
  });

  it('refuses brand-violating proposed_text', () => {
    const result = validateProposal({
      diff: baseDiff({
        edits: [
          {
            kind: 'rewrite',
            section_path: 'section.assays',
            rationale: 'r',
            proposed_text: '<p style="color:#123456">hi</p>',
          },
        ],
      }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some((v) => v.startsWith('inline_style')),
      ).toBe(true);
    }
  });

  it('refuses an empty summary', () => {
    const result = validateProposal({
      diff: baseDiff({ summary: '   ' }),
      known_section_paths: ['section.assays'],
      available_citation_refs: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('lintProposalText', () => {
  it('accepts plain text without colors', () => {
    expect(lintProposalText('Hello world')).toEqual([]);
  });

  it('refuses inline style attributes', () => {
    const violations = lintProposalText('<p style="color:red">x</p>');
    expect(violations.some((v) => v.startsWith('inline_style'))).toBe(true);
  });

  it('refuses off-brand hex literals', () => {
    const violations = lintProposalText('color: #123456');
    expect(violations.some((v) => v.startsWith('off_brand_hex'))).toBe(true);
  });

  it('accepts approved palette hex literals', () => {
    expect(lintProposalText('color: #0ea5e9')).toEqual([]);
  });

  it('refuses rgb/hsl literals outright', () => {
    expect(lintProposalText('color: rgb(0,0,0)')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/disallowed_color_form/),
      ]),
    );
  });
});
