import { describe, expect, it } from 'vitest';
import {
  findBackdoorAdjustmentSet,
  isAdmissibleBackdoorSet,
} from '../identify/backdoor-criterion.js';
import { CausalInferenceError, type CausalGraph } from '../types.js';

/**
 * Pearl's textbook smoking-cancer DAG (Causality, §3.3): smoking and
 * cancer share a confounder (genotype). The back-door criterion says
 * that {genotype} is admissible for the smoking -> cancer effect.
 */
function pearlSmokingCancerGraph(): CausalGraph {
  return {
    nodes: ['genotype', 'smoking', 'cancer'],
    edges: [
      { from: 'genotype', to: 'smoking' },
      { from: 'genotype', to: 'cancer' },
      { from: 'smoking', to: 'cancer' },
    ],
  };
}

describe('Pearl back-door identification — textbook examples', () => {
  it('identifies {genotype} as the back-door set for smoking -> cancer', () => {
    const g = pearlSmokingCancerGraph();
    const r = findBackdoorAdjustmentSet(g, 'smoking', 'cancer');
    expect(r.adjustmentSet).toEqual(['genotype']);
  });

  it('confirms {genotype} is admissible via isAdmissibleBackdoorSet', () => {
    const g = pearlSmokingCancerGraph();
    expect(isAdmissibleBackdoorSet(g, 'smoking', 'cancer', ['genotype'])).toBe(
      true,
    );
  });

  it('rejects the empty set when a back-door path exists', () => {
    const g = pearlSmokingCancerGraph();
    expect(isAdmissibleBackdoorSet(g, 'smoking', 'cancer', [])).toBe(false);
  });

  it('rejects a descendant of the treatment as adjustment', () => {
    const g: CausalGraph = {
      nodes: ['x', 'm', 'y'],
      edges: [
        { from: 'x', to: 'm' },
        { from: 'm', to: 'y' },
      ],
    };
    expect(isAdmissibleBackdoorSet(g, 'x', 'y', ['m'])).toBe(false);
  });

  it('finds the empty set sufficient when there is no confounder', () => {
    const g: CausalGraph = {
      nodes: ['x', 'y'],
      edges: [{ from: 'x', to: 'y' }],
    };
    const r = findBackdoorAdjustmentSet(g, 'x', 'y');
    expect(r.adjustmentSet).toEqual([]);
  });

  it('throws UNKNOWN_NODE on a missing variable', () => {
    const g = pearlSmokingCancerGraph();
    expect(() => findBackdoorAdjustmentSet(g, 'absent', 'cancer')).toThrow(
      CausalInferenceError,
    );
  });
});
