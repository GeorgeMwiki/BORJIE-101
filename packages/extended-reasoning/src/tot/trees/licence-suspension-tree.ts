import type { DecisionTree, ToTContext } from '../types.js';

/**
 * Licence-suspension / incursion-response decision tree.
 *
 * Drives the escalation path when a counterparty operator falls into
 * outstanding-royalty default on a licensed mining site.
 *
 * Reads context facts:
 *   - notice_served (boolean)
 *   - days_elapsed_since_notice (number)
 *   - operator_in_default (boolean)
 *   - mediation_opt_in (boolean)
 *   - mediation_offered (boolean)
 *   - jurisdiction (string, e.g. 'TZ-GEITA' / 'KE-NRB')
 *
 * Tree structure is FIXED. Per-counterparty facts vary.
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;
const num = (ctx: ToTContext, key: string): number => {
  const v = ctx.facts[key];
  return typeof v === 'number' ? v : 0;
};

export const LICENCE_SUSPENSION_TREE: DecisionTree = {
  id: 'licence-suspension.v1',
  rootNodeId: 'root',
  nodes: {
    root: {
      id: 'root',
      question: 'Has a Notice of Default been served?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'notice_served'), toNodeId: 'q_default' },
        { label: 'yes', when: (c) => bool(c, 'notice_served'), toNodeId: 'q_days_elapsed' },
      ],
    },
    q_default: {
      id: 'q_default',
      question: 'Is the operator in royalty default?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'operator_in_default'), toNodeId: 'out_no_grounds' },
        { label: 'yes', when: (c) => bool(c, 'operator_in_default'), toNodeId: 'q_mediation_clause' },
      ],
    },
    q_mediation_clause: {
      id: 'q_mediation_clause',
      question: 'Has the owner opted into the Mining Commission mediation-first clause?',
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
        { label: '14-30', when: (c) => num(c, 'days_elapsed_since_notice') < 30, toNodeId: 'out_file_commission' },
        { label: '>=30', when: (c) => num(c, 'days_elapsed_since_notice') >= 30, toNodeId: 'out_suspend' },
      ],
    },
    out_no_grounds: { id: 'out_no_grounds', question: '', outcome: 'no-grounds' },
    out_create_notice: { id: 'out_create_notice', question: '', outcome: 'create-notice' },
    out_offer_mediation: { id: 'out_offer_mediation', question: '', outcome: 'offer-mediation' },
    out_wait_cure: { id: 'out_wait_cure', question: '', outcome: 'wait-cure-period' },
    out_file_commission: { id: 'out_file_commission', question: '', outcome: 'file-commission' },
    out_suspend: { id: 'out_suspend', question: '', outcome: 'suspend-licence' },
  },
};
