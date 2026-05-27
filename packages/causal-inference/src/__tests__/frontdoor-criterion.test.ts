import { describe, expect, it } from 'vitest';
import {
  findFrontdoorMediatorSet,
  isFrontdoorMediatorSet,
} from '../identify/frontdoor-criterion.js';
import { type CausalGraph } from '../types.js';

/**
 * Pearl's textbook smoking -> tar -> cancer DAG with an UNobserved
 * genotype confounder (Causality §3.4). Because the confounder is
 * unobserved we drop it from the node list; what remains is a chain
 * smoking -> tar -> cancer plus the back-door path through a
 * latent that we model by adding an explicit "u" confounder so the
 * graph still exhibits the structural pattern.
 */
function pearlSmokingTarCancerGraph(): CausalGraph {
  return {
    nodes: ['u', 'smoking', 'tar', 'cancer'],
    edges: [
      { from: 'u', to: 'smoking' },
      { from: 'u', to: 'cancer' },
      { from: 'smoking', to: 'tar' },
      { from: 'tar', to: 'cancer' },
    ],
  };
}

describe('Pearl front-door identification — textbook examples', () => {
  it('identifies {tar} as the front-door mediator for smoking -> cancer', () => {
    const g = pearlSmokingTarCancerGraph();
    const r = findFrontdoorMediatorSet(g, 'smoking', 'cancer');
    expect(r.mediatorSet).toEqual(['tar']);
  });

  it('confirms {tar} satisfies all three front-door conditions', () => {
    const g = pearlSmokingTarCancerGraph();
    expect(isFrontdoorMediatorSet(g, 'smoking', 'cancer', ['tar'])).toBe(true);
  });

  it('rejects an empty mediator set', () => {
    const g = pearlSmokingTarCancerGraph();
    expect(isFrontdoorMediatorSet(g, 'smoking', 'cancer', [])).toBe(false);
  });

  it('rejects a set that does not intercept all directed paths', () => {
    const g: CausalGraph = {
      nodes: ['x', 'm', 'n', 'y'],
      edges: [
        { from: 'x', to: 'y' },
        { from: 'x', to: 'm' },
        { from: 'm', to: 'y' },
      ],
    };
    // {m} does not intercept the direct x -> y edge.
    expect(isFrontdoorMediatorSet(g, 'x', 'y', ['m'])).toBe(false);
  });
});
