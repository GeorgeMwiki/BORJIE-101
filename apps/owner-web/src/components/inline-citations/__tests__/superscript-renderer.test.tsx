/**
 * R1 — SuperscriptRenderer + parser tests
 *
 * Covers:
 *  - parser splits `text` and `citation` tokens
 *  - parser handles multi-digit superscript (¹²)
 *  - renderer maps citation index → evidenceIds[index-1]
 *  - renderer falls back to raw glyph when index out of range
 *  - clicking a chip invokes onSelectEvidence with the right id
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { SuperscriptRenderer } from '../SuperscriptRenderer';
import {
  parseSuperscriptCitations,
  isSuperscriptDigit,
} from '../superscript-parser';

describe('parseSuperscriptCitations', () => {
  it('returns a single text token for plain prose', () => {
    const tokens = parseSuperscriptCitations('hello world');
    expect(tokens).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('splits text + single-digit citation', () => {
    const tokens = parseSuperscriptCitations('Gold up 5%¹.');
    expect(tokens).toEqual([
      { kind: 'text', value: 'Gold up 5%' },
      { kind: 'citation', index: 1, raw: '¹' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('handles consecutive multi-digit citations as one index (¹² = 12)', () => {
    const tokens = parseSuperscriptCitations('A¹² claim.');
    expect(tokens).toEqual([
      { kind: 'text', value: 'A' },
      { kind: 'citation', index: 12, raw: '¹²' },
      { kind: 'text', value: ' claim.' },
    ]);
  });

  it('handles three citations in one sentence', () => {
    const tokens = parseSuperscriptCitations('Up¹, down², flat³.');
    const citations = tokens.filter((t) => t.kind === 'citation');
    expect(citations.map((c) => c.kind === 'citation' && c.index)).toEqual([
      1, 2, 3,
    ]);
  });

  it('exposes the digit predicate as a utility', () => {
    expect(isSuperscriptDigit('¹')).toBe(true);
    expect(isSuperscriptDigit('1')).toBe(false);
    expect(isSuperscriptDigit('a')).toBe(false);
  });
});

describe('SuperscriptRenderer', () => {
  it('renders text spans and clickable chip with right evidence id', () => {
    const onSelect = vi.fn();
    render(
      <SuperscriptRenderer
        text="Gold price up 5%¹ this week."
        evidenceIds={['evidence-abc']}
        onSelectEvidence={onSelect}
      />,
    );

    const chip = screen.getByTestId('inline-citation-chip');
    expect(chip).toHaveAttribute('data-evidence-id', 'evidence-abc');
    expect(chip).toHaveAttribute('data-citation-index', '1');
    expect(chip).toHaveTextContent('¹');

    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith('evidence-abc');
  });

  it('renders orphan chip (no click handler) when index out of range', () => {
    const onSelect = vi.fn();
    render(
      <SuperscriptRenderer
        text="A claim with no source⁵."
        evidenceIds={['only-one']}
        onSelectEvidence={onSelect}
      />,
    );
    const orphan = screen.getByTestId('inline-citation-orphan');
    expect(orphan).toHaveTextContent('⁵');
    expect(screen.queryByTestId('inline-citation-chip')).toBeNull();
  });

  it('renders multiple chips in order', () => {
    const onSelect = vi.fn();
    render(
      <SuperscriptRenderer
        text="One¹ two² three³."
        evidenceIds={['e1', 'e2', 'e3']}
        onSelectEvidence={onSelect}
      />,
    );
    const chips = screen.getAllByTestId('inline-citation-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveAttribute('data-evidence-id', 'e1');
    expect(chips[1]).toHaveAttribute('data-evidence-id', 'e2');
    expect(chips[2]).toHaveAttribute('data-evidence-id', 'e3');
  });
});
