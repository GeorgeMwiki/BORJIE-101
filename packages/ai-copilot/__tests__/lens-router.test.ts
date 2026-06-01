/**
 * Lens router — the Master Brain's INTERNAL persona palette.
 *
 * Pins the WS-0 contract: there are no user-selectable "modes". The brain
 * classifies the owner's message into 1..N internal lenses (the former CEO
 * modes) and blends them. A narrow message selects one lens; a cross-domain
 * message selects several.
 *
 * The classifier is deterministic (signal-scored, no LLM) so this behaviour
 * is testable offline without an API key — the brain's Sonnet pass still does
 * the final junior selection, now steered by the blended lens directive.
 */

import { describe, it, expect } from 'vitest';
import {
  LENS_REGISTRY,
  classifyLenses,
  DEFAULT_LENS_ID,
  type LensId,
} from '../src/juniors/lens-router.js';
import { MasterBrainMode } from '../src/juniors/master-brain.js';

const ALL_LENS_IDS: ReadonlyArray<LensId> = [
  'build',
  'strategy',
  'operations',
  'document',
  'finance',
  'risk',
  'board',
  'compliance',
];

describe('LENS_REGISTRY', () => {
  it('covers exactly the eight former CEO lenses with unique ids', () => {
    const ids = LENS_REGISTRY.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...ALL_LENS_IDS].sort());
  });

  it('maps every lens to a valid internal MasterBrainMode', () => {
    for (const lens of LENS_REGISTRY) {
      expect(MasterBrainMode.options).toContain(lens.derivedMode);
    }
  });

  it('gives every lens a non-empty directive and at least one junior affinity', () => {
    for (const lens of LENS_REGISTRY) {
      expect(lens.directive.trim().length).toBeGreaterThan(0);
      expect(lens.juniorAffinities.length).toBeGreaterThan(0);
    }
  });
});

describe('classifyLenses — blends ≥2 lenses on a cross-domain prompt', () => {
  const selection = classifyLenses(
    'Should I sell my Nachingwea graphite now given FX exposure and the PML licence renewal?',
  );

  it('selects two or more lenses', () => {
    expect(selection.lenses.length).toBeGreaterThanOrEqual(2);
  });

  it('blends finance + compliance + strategy (the question spans all three)', () => {
    expect(selection.lenses).toContain('finance');
    expect(selection.lenses).toContain('compliance');
    expect(selection.lenses).toContain('strategy');
  });

  it('produces a blended directive that names each selected lens', () => {
    for (const id of selection.lenses) {
      const lens = LENS_REGISTRY.find((l) => l.id === id)!;
      expect(selection.directive).toContain(lens.label);
    }
  });

  it('derives the brain mode from the primary lens', () => {
    const primaryLens = LENS_REGISTRY.find((l) => l.id === selection.primary)!;
    expect(selection.derivedMode).toBe(primaryLens.derivedMode);
    expect(selection.lenses[0]).toBe(selection.primary);
  });
});

describe('classifyLenses — narrows to one lens on a single-domain prompt', () => {
  it('selects exactly the operations lens for a shift summary', () => {
    const selection = classifyLenses(
      "Summarise last night's shift performance at Nyakabale.",
    );
    expect(selection.lenses).toEqual(['operations']);
    expect(selection.primary).toBe('operations');
  });

  it('selects exactly the compliance lens for an obligations question', () => {
    const selection = classifyLenses(
      'List every Mining Act 2010 obligation I am within 30 days of.',
    );
    expect(selection.lenses).toEqual(['compliance']);
  });
});

describe('classifyLenses — robustness', () => {
  it('always returns at least one lens, falling back to the default', () => {
    const selection = classifyLenses('Hello');
    expect(selection.lenses.length).toBe(1);
    expect(selection.lenses[0]).toBe(DEFAULT_LENS_ID);
    expect(MasterBrainMode.options).toContain(selection.derivedMode);
  });

  it('honours the maxLenses cap', () => {
    const selection = classifyLenses(
      'Should I sell my graphite given FX exposure and the licence renewal?',
      { maxLenses: 2 },
    );
    expect(selection.lenses.length).toBeLessThanOrEqual(2);
  });

  it('orders selected lenses by descending signal strength (primary first)', () => {
    const selection = classifyLenses(
      'Draft a board investor pack and also flag any licence renewal obligations.',
    );
    // "board investor pack" (3 signals) should outrank a lone "licence renewal".
    expect(selection.primary).toBe('board');
    expect(selection.lenses[0]).toBe('board');
  });
});
