import type { DecisionTree, ToTContext } from '../types.js';

/**
 * TRA (Tanzania Revenue Authority) royalty-return filing route tree.
 *
 * Reads facts:
 *   - jurisdiction (e.g. 'TZ-GEITA' | 'KE-NRB') — non-TZ returns 'not-applicable'
 *   - mineral_sales_above_threshold (boolean) — royalty-return regime kicks in
 *   - tra_tin_active (boolean)
 *   - return_period_open (boolean) — i.e. current month not yet filed
 *   - has_outstanding_royalties (boolean) — outstanding TRA balance
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;
const str = (ctx: ToTContext, key: string): string => {
  const v = ctx.facts[key];
  return typeof v === 'string' ? v : '';
};

export const TRA_FILING_TREE: DecisionTree = {
  id: 'tra-filing.v1',
  rootNodeId: 'q_jurisdiction',
  nodes: {
    q_jurisdiction: {
      id: 'q_jurisdiction',
      question: 'Is this mining site in Tanzania?',
      edges: [
        { label: 'TZ', when: (c) => str(c, 'jurisdiction').startsWith('TZ'), toNodeId: 'q_tin' },
        { label: 'non-TZ', when: (c) => !str(c, 'jurisdiction').startsWith('TZ'), toNodeId: 'out_not_applicable' },
      ],
    },
    q_tin: {
      id: 'q_tin',
      question: 'Is the owner TRA TIN active?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'tra_tin_active'), toNodeId: 'out_register_tin' },
        { label: 'yes', when: (c) => bool(c, 'tra_tin_active'), toNodeId: 'q_threshold' },
      ],
    },
    q_threshold: {
      id: 'q_threshold',
      question: 'Are mineral sales above the royalty-return threshold?',
      edges: [
        { label: 'above', when: (c) => bool(c, 'mineral_sales_above_threshold'), toNodeId: 'q_period' },
        { label: 'below', when: (c) => !bool(c, 'mineral_sales_above_threshold'), toNodeId: 'out_corporate_regime' },
      ],
    },
    q_period: {
      id: 'q_period',
      question: 'Is the current return period still open?',
      edges: [
        { label: 'open', when: (c) => bool(c, 'return_period_open'), toNodeId: 'q_outstanding' },
        { label: 'closed', when: (c) => !bool(c, 'return_period_open'), toNodeId: 'out_late_filing' },
      ],
    },
    q_outstanding: {
      id: 'q_outstanding',
      question: 'Is there an outstanding TRA balance?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'has_outstanding_royalties'), toNodeId: 'out_settle_then_file' },
        { label: 'no', when: (c) => !bool(c, 'has_outstanding_royalties'), toNodeId: 'out_file_royalty_return' },
      ],
    },
    out_not_applicable: { id: 'out_not_applicable', question: '', outcome: 'not-applicable' },
    out_register_tin: { id: 'out_register_tin', question: '', outcome: 'register-tin' },
    out_corporate_regime: { id: 'out_corporate_regime', question: '', outcome: 'corporate-regime' },
    out_late_filing: { id: 'out_late_filing', question: '', outcome: 'late-filing-process' },
    out_settle_then_file: { id: 'out_settle_then_file', question: '', outcome: 'settle-outstanding-then-file-royalty-return' },
    out_file_royalty_return: { id: 'out_file_royalty_return', question: '', outcome: 'file-royalty-return' },
  },
};
