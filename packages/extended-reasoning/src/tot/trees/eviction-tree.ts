import type { DecisionTree, ToTContext } from '../types.js';

/**
 * Eviction decision tree.
 *
 * Reads context facts:
 *   - notice_served (boolean)
 *   - days_elapsed_since_notice (number)
 *   - tenant_in_arrears (boolean)
 *   - mediation_opt_in (boolean)
 *   - mediation_offered (boolean)
 *   - jurisdiction (string, e.g. 'TZ-DSM' / 'KE-NRB')
 *
 * Tree structure is FIXED. Per-tenant facts vary.
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;
const num = (ctx: ToTContext, key: string): number => {
  const v = ctx.facts[key];
  return typeof v === 'number' ? v : 0;
};

export const EVICTION_DECISION_TREE: DecisionTree = {
  id: 'eviction.v1',
  rootNodeId: 'root',
  nodes: {
    root: {
      id: 'root',
      question: 'Has a Notice to Quit been served?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'notice_served'), toNodeId: 'q_arrears' },
        { label: 'yes', when: (c) => bool(c, 'notice_served'), toNodeId: 'q_days_elapsed' },
      ],
    },
    q_arrears: {
      id: 'q_arrears',
      question: 'Is the tenant in arrears?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'tenant_in_arrears'), toNodeId: 'out_no_grounds' },
        { label: 'yes', when: (c) => bool(c, 'tenant_in_arrears'), toNodeId: 'q_mediation_clause' },
      ],
    },
    q_mediation_clause: {
      id: 'q_mediation_clause',
      question: 'Has the landlord opted into the mediation-first clause?',
      edges: [
        {
          label: 'no',
          when: (c) => !bool(c, 'mediation_opt_in'),
          toNodeId: 'out_create_notice',
        },
        {
          label: 'yes',
          when: (c) => bool(c, 'mediation_opt_in'),
          toNodeId: 'q_mediation_offered',
        },
      ],
    },
    q_mediation_offered: {
      id: 'q_mediation_offered',
      question: 'Has a mediation offer already been made?',
      edges: [
        {
          label: 'no',
          when: (c) => !bool(c, 'mediation_offered'),
          toNodeId: 'out_offer_mediation',
        },
        {
          label: 'yes',
          when: (c) => bool(c, 'mediation_offered'),
          toNodeId: 'out_create_notice',
        },
      ],
    },
    q_days_elapsed: {
      id: 'q_days_elapsed',
      question: 'How many days have elapsed since notice was served?',
      edges: [
        { label: '<14', when: (c) => num(c, 'days_elapsed_since_notice') < 14, toNodeId: 'out_wait_cure' },
        { label: '14-30', when: (c) => num(c, 'days_elapsed_since_notice') < 30, toNodeId: 'out_file_court' },
        { label: '>=30', when: (c) => num(c, 'days_elapsed_since_notice') >= 30, toNodeId: 'out_enforce' },
      ],
    },
    out_no_grounds: { id: 'out_no_grounds', question: '', outcome: 'no-grounds' },
    out_create_notice: { id: 'out_create_notice', question: '', outcome: 'create-notice' },
    out_offer_mediation: { id: 'out_offer_mediation', question: '', outcome: 'offer-mediation' },
    out_wait_cure: { id: 'out_wait_cure', question: '', outcome: 'wait-cure-period' },
    out_file_court: { id: 'out_file_court', question: '', outcome: 'file-court' },
    out_enforce: { id: 'out_enforce', question: '', outcome: 'enforce-eviction' },
  },
};
