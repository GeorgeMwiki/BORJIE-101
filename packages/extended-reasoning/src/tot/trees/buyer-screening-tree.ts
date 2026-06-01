import type { DecisionTree, ToTContext } from '../types.js';

/**
 * Buyer screening tree.
 *
 * Vets a prospective mineral buyer / counterparty before an offtake or
 * supply agreement is extended.
 *
 * Reads facts:
 *   - id_verified (boolean)
 *   - licence_verified (boolean) — buyer holds a valid mineral-dealer licence
 *   - income_to_offtake_ratio (number, e.g. 3.0 = 3x offtake commitment)
 *   - reference_count (number)
 *   - past_default (boolean)
 *   - past_default_within_3y (boolean)
 *   - credit_score_band (string, 'high' | 'mid' | 'low' | 'unscored')
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;
const num = (ctx: ToTContext, key: string): number => {
  const v = ctx.facts[key];
  return typeof v === 'number' ? v : 0;
};
const str = (ctx: ToTContext, key: string): string => {
  const v = ctx.facts[key];
  return typeof v === 'string' ? v : '';
};

export const BUYER_SCREENING_TREE: DecisionTree = {
  id: 'buyer-screening.v1',
  rootNodeId: 'q_id',
  nodes: {
    q_id: {
      id: 'q_id',
      question: 'Is government ID verified?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'id_verified'), toNodeId: 'out_request_id' },
        { label: 'yes', when: (c) => bool(c, 'id_verified'), toNodeId: 'q_past_default' },
      ],
    },
    q_past_default: {
      id: 'q_past_default',
      question: 'Past offtake default on record?',
      edges: [
        {
          label: 'yes-recent',
          when: (c) => bool(c, 'past_default') && bool(c, 'past_default_within_3y'),
          toNodeId: 'out_decline',
        },
        {
          label: 'yes-old',
          when: (c) => bool(c, 'past_default') && !bool(c, 'past_default_within_3y'),
          toNodeId: 'q_licence',
        },
        {
          label: 'no',
          when: (c) => !bool(c, 'past_default'),
          toNodeId: 'q_licence',
        },
      ],
    },
    q_licence: {
      id: 'q_licence',
      question: 'Is the mineral-dealer licence verified?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'licence_verified'), toNodeId: 'q_credit' },
        { label: 'yes', when: (c) => bool(c, 'licence_verified'), toNodeId: 'q_offtake_ratio' },
      ],
    },
    q_credit: {
      id: 'q_credit',
      question: 'What is the credit-score band?',
      edges: [
        { label: 'high', when: (c) => str(c, 'credit_score_band') === 'high', toNodeId: 'out_approve_with_guarantor' },
        { label: 'mid', when: (c) => str(c, 'credit_score_band') === 'mid', toNodeId: 'out_request_licence' },
        { label: 'low/unscored', when: (c) => ['low', 'unscored', ''].includes(str(c, 'credit_score_band')), toNodeId: 'out_decline' },
      ],
    },
    q_offtake_ratio: {
      id: 'q_offtake_ratio',
      question: 'Income-to-offtake ratio (cushion)?',
      edges: [
        { label: '>=3x', when: (c) => num(c, 'income_to_offtake_ratio') >= 3, toNodeId: 'q_references' },
        { label: '2-3x', when: (c) => num(c, 'income_to_offtake_ratio') >= 2, toNodeId: 'out_approve_with_advance_uplift' },
        { label: '<2x', when: (c) => num(c, 'income_to_offtake_ratio') < 2, toNodeId: 'out_decline' },
      ],
    },
    q_references: {
      id: 'q_references',
      question: 'How many references collected?',
      edges: [
        { label: '>=2', when: (c) => num(c, 'reference_count') >= 2, toNodeId: 'out_approve' },
        { label: '<2', when: (c) => num(c, 'reference_count') < 2, toNodeId: 'out_request_references' },
      ],
    },
    out_request_id: { id: 'out_request_id', question: '', outcome: 'request-id' },
    out_decline: { id: 'out_decline', question: '', outcome: 'decline' },
    out_request_licence: { id: 'out_request_licence', question: '', outcome: 'request-licence-proof' },
    out_request_references: { id: 'out_request_references', question: '', outcome: 'request-references' },
    out_approve: { id: 'out_approve', question: '', outcome: 'approve' },
    out_approve_with_advance_uplift: { id: 'out_approve_with_advance_uplift', question: '', outcome: 'approve-with-advance-uplift' },
    out_approve_with_guarantor: { id: 'out_approve_with_guarantor', question: '', outcome: 'approve-with-guarantor' },
  },
};
