import { describe, expect, it } from 'vitest';
import {
  runToT,
  runToTTree,
  validateTree,
  EVICTION_DECISION_TREE,
  VENDOR_SELECTION_TREE,
  KRA_FILING_TREE,
  TENANT_SCREENING_TREE,
} from './index.js';
import type { DecisionTree, ToTContext } from './types.js';

const ctx = (facts: ToTContext['facts']): ToTContext => ({ facts });

describe('runToT — free-form BFS/DFS over a thought space', () => {
  it('rejects negative depth / non-positive branches', () => {
    expect(() =>
      runToT({
        rootThought: 'x',
        branchingFn: () => [],
        evaluationFn: () => 0,
        search: 'bfs',
        maxDepth: -1,
        maxBranches: 1,
        ctx: ctx({}),
      }),
    ).toThrow(/maxDepth/);
    expect(() =>
      runToT({
        rootThought: 'x',
        branchingFn: () => [],
        evaluationFn: () => 0,
        search: 'bfs',
        maxDepth: 1,
        maxBranches: 0,
        ctx: ctx({}),
      }),
    ).toThrow(/maxBranches/);
  });

  it('BFS picks best thought across a 2-level tree', () => {
    // branching: each thought spawns thought + '.A' and thought + '.B'
    // evaluation: longer = higher (so deepest BFS wins)
    const result = runToT({
      rootThought: 'r',
      branchingFn: (_c, t) => [`${t}.A`, `${t}.B`, `${t}.C`],
      evaluationFn: (_c, t) => t.length,
      search: 'bfs',
      maxDepth: 2,
      maxBranches: 2,
      ctx: ctx({}),
    });
    expect(result.bestThought.length).toBeGreaterThanOrEqual('r.A.A'.length);
  });

  it('DFS exhausts deeper branches before siblings', () => {
    const visited: string[] = [];
    runToT({
      rootThought: 'r',
      branchingFn: (_c, t, d) => (d < 2 ? [`${t}1`, `${t}2`] : []),
      evaluationFn: (_c, t) => {
        visited.push(t);
        return t.length;
      },
      search: 'dfs',
      maxDepth: 2,
      maxBranches: 2,
      ctx: ctx({}),
    });
    // The runner evaluates children at generation time, then pushes them
    // onto the frontier. DFS pops the last pushed frame so r2 is expanded
    // before r1 — r2's grand-children appear in visited before r1's.
    expect(visited.indexOf('r22')).toBeLessThan(visited.indexOf('r12'));
    expect(visited.indexOf('r21')).toBeLessThan(visited.indexOf('r11'));
  });

  it('BFS visits siblings before grand-children', () => {
    const visited: string[] = [];
    runToT({
      rootThought: 'r',
      branchingFn: (_c, t, d) => (d < 2 ? [`${t}1`, `${t}2`] : []),
      evaluationFn: (_c, t) => {
        visited.push(t);
        return t.length;
      },
      search: 'bfs',
      maxDepth: 2,
      maxBranches: 2,
      ctx: ctx({}),
    });
    // r1 (depth=1) must precede r11 (depth=2).
    expect(visited.indexOf('r1')).toBeLessThan(visited.indexOf('r11'));
    expect(visited.indexOf('r2')).toBeLessThan(visited.indexOf('r11'));
  });
});

describe('runToTTree — fixed decision-tree walker', () => {
  it('throws on cycle', () => {
    const bad: DecisionTree = {
      id: 'cycle.v1',
      rootNodeId: 'a',
      nodes: {
        a: {
          id: 'a',
          question: 'q',
          edges: [{ label: 'l', when: () => true, toNodeId: 'b' }],
        },
        b: {
          id: 'b',
          question: 'q',
          edges: [{ label: 'l', when: () => true, toNodeId: 'a' }],
        },
      },
    };
    expect(() => runToTTree({ tree: bad, ctx: ctx({}) })).toThrow(/cycle detected/);
  });

  it('throws on under-specified context (no edge matches, no default outcome)', () => {
    const bad: DecisionTree = {
      id: 'under.v1',
      rootNodeId: 'a',
      nodes: {
        a: {
          id: 'a',
          question: 'q',
          edges: [{ label: 'l', when: () => false, toNodeId: 'b' }],
        },
        b: { id: 'b', question: '', outcome: 'b' },
      },
    };
    expect(() => runToTTree({ tree: bad, ctx: ctx({}) })).toThrow(/under-specified context/);
  });

  it('falls through to inline outcome when no edge matches but outcome exists', () => {
    const tree: DecisionTree = {
      id: 'default.v1',
      rootNodeId: 'a',
      nodes: {
        a: {
          id: 'a',
          question: 'q',
          outcome: 'default-fallback',
          edges: [{ label: 'l', when: () => false, toNodeId: 'b' }],
        },
        b: { id: 'b', question: '', outcome: 'b' },
      },
    };
    const r = runToTTree({ tree, ctx: ctx({}) });
    expect(r.outcome).toBe('default-fallback');
  });
});

describe('validateTree — structural validation', () => {
  it('all 4 built-in trees pass validation', () => {
    for (const tree of [
      EVICTION_DECISION_TREE,
      VENDOR_SELECTION_TREE,
      KRA_FILING_TREE,
      TENANT_SCREENING_TREE,
    ]) {
      expect(validateTree(tree)).toEqual([]);
    }
  });

  it('flags broken edges and unkeyed nodes', () => {
    const broken: DecisionTree = {
      id: 'broken.v1',
      rootNodeId: 'ghost',
      nodes: {
        a: {
          id: 'a',
          question: 'q',
          edges: [{ label: 'l', when: () => true, toNodeId: 'nowhere' }],
        },
        b: { id: 'WRONG', question: '', outcome: 'b' },
      },
    };
    const errs = validateTree(broken);
    expect(errs.some((e) => e.includes('root node'))).toBe(true);
    expect(errs.some((e) => e.includes('unknown node "nowhere"'))).toBe(true);
    expect(errs.some((e) => e.includes('does not match'))).toBe(true);
  });
});

describe('EVICTION_DECISION_TREE — 3 fixtures', () => {
  it('fixture A — arrears + mediation clause + no offer yet → offer-mediation', () => {
    const r = runToTTree({
      tree: EVICTION_DECISION_TREE,
      ctx: ctx({
        notice_served: false,
        tenant_in_arrears: true,
        mediation_opt_in: true,
        mediation_offered: false,
      }),
    });
    expect(r.outcome).toBe('offer-mediation');
    expect(r.path.map((p) => p.nodeId)).toEqual([
      'root',
      'q_arrears',
      'q_mediation_clause',
      'q_mediation_offered',
      'out_offer_mediation',
    ]);
  });

  it('fixture B — notice served 20 days ago → file-court', () => {
    const r = runToTTree({
      tree: EVICTION_DECISION_TREE,
      ctx: ctx({ notice_served: true, days_elapsed_since_notice: 20 }),
    });
    expect(r.outcome).toBe('file-court');
  });

  it('fixture C — no arrears → no-grounds', () => {
    const r = runToTTree({
      tree: EVICTION_DECISION_TREE,
      ctx: ctx({ notice_served: false, tenant_in_arrears: false }),
    });
    expect(r.outcome).toBe('no-grounds');
  });
});

describe('VENDOR_SELECTION_TREE — 3 fixtures', () => {
  it('fixture A — emergency + preferred vendor → dispatch-preferred', () => {
    const r = runToTTree({
      tree: VENDOR_SELECTION_TREE,
      ctx: ctx({ is_emergency: true, has_preferred_vendor: true }),
    });
    expect(r.outcome).toBe('dispatch-preferred');
  });

  it('fixture B — non-emergency, under warranty → warranty-claim', () => {
    const r = runToTTree({
      tree: VENDOR_SELECTION_TREE,
      ctx: ctx({ is_emergency: false, in_warranty: true }),
    });
    expect(r.outcome).toBe('warranty-claim');
  });

  it('fixture C — non-emergency, no warranty, quote above threshold → request-owner-approval', () => {
    const r = runToTTree({
      tree: VENDOR_SELECTION_TREE,
      ctx: ctx({
        is_emergency: false,
        in_warranty: false,
        quote_collected: true,
        quote_under_threshold: false,
      }),
    });
    expect(r.outcome).toBe('request-owner-approval');
  });
});

describe('KRA_FILING_TREE — 3 fixtures', () => {
  it('fixture A — TZ property → not-applicable', () => {
    const r = runToTTree({
      tree: KRA_FILING_TREE,
      ctx: ctx({ jurisdiction: 'TZ-DSM' }),
    });
    expect(r.outcome).toBe('not-applicable');
  });

  it('fixture B — KE, PIN active, above threshold, open period, no arrears → file-mri', () => {
    const r = runToTTree({
      tree: KRA_FILING_TREE,
      ctx: ctx({
        jurisdiction: 'KE-NRB',
        kra_pin_active: true,
        rent_income_above_threshold: true,
        tax_period_open: true,
        has_arrears_owing: false,
      }),
    });
    expect(r.outcome).toBe('file-mri');
  });

  it('fixture C — KE, no PIN → register-pin', () => {
    const r = runToTTree({
      tree: KRA_FILING_TREE,
      ctx: ctx({ jurisdiction: 'KE-NRB', kra_pin_active: false }),
    });
    expect(r.outcome).toBe('register-pin');
  });
});

describe('TENANT_SCREENING_TREE — 3 fixtures', () => {
  it('fixture A — recent eviction → decline regardless of other facts', () => {
    const r = runToTTree({
      tree: TENANT_SCREENING_TREE,
      ctx: ctx({
        id_verified: true,
        past_eviction: true,
        past_eviction_within_3y: true,
        employment_verified: true,
        income_to_rent_ratio: 5,
        reference_count: 3,
      }),
    });
    expect(r.outcome).toBe('decline');
  });

  it('fixture B — clean record, 3x income, 2 refs → approve', () => {
    const r = runToTTree({
      tree: TENANT_SCREENING_TREE,
      ctx: ctx({
        id_verified: true,
        past_eviction: false,
        employment_verified: true,
        income_to_rent_ratio: 3.2,
        reference_count: 2,
      }),
    });
    expect(r.outcome).toBe('approve');
  });

  it('fixture C — no ID verified → request-id', () => {
    const r = runToTTree({
      tree: TENANT_SCREENING_TREE,
      ctx: ctx({ id_verified: false }),
    });
    expect(r.outcome).toBe('request-id');
  });
});
