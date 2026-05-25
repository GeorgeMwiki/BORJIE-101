import type { DecisionTree, ToTContext } from '../types.js';

/**
 * KRA (Kenya Revenue Authority) monthly filing route tree.
 *
 * Reads facts:
 *   - jurisdiction (e.g. 'KE-NRB' | 'TZ-DSM') — non-KE returns 'not-applicable'
 *   - rent_income_above_threshold (boolean) — Monthly Rental Income (MRI) regime kicks in
 *   - kra_pin_active (boolean)
 *   - tax_period_open (boolean) — i.e. current month not yet filed
 *   - has_arrears_owing (boolean) — outstanding KRA balance
 */

const bool = (ctx: ToTContext, key: string): boolean => ctx.facts[key] === true;
const str = (ctx: ToTContext, key: string): string => {
  const v = ctx.facts[key];
  return typeof v === 'string' ? v : '';
};

export const KRA_FILING_TREE: DecisionTree = {
  id: 'kra-filing.v1',
  rootNodeId: 'q_jurisdiction',
  nodes: {
    q_jurisdiction: {
      id: 'q_jurisdiction',
      question: 'Is this property in Kenya?',
      edges: [
        { label: 'KE', when: (c) => str(c, 'jurisdiction').startsWith('KE'), toNodeId: 'q_pin' },
        { label: 'non-KE', when: (c) => !str(c, 'jurisdiction').startsWith('KE'), toNodeId: 'out_not_applicable' },
      ],
    },
    q_pin: {
      id: 'q_pin',
      question: 'Is the landlord KRA PIN active?',
      edges: [
        { label: 'no', when: (c) => !bool(c, 'kra_pin_active'), toNodeId: 'out_register_pin' },
        { label: 'yes', when: (c) => bool(c, 'kra_pin_active'), toNodeId: 'q_threshold' },
      ],
    },
    q_threshold: {
      id: 'q_threshold',
      question: 'Is income above the MRI threshold?',
      edges: [
        { label: 'above', when: (c) => bool(c, 'rent_income_above_threshold'), toNodeId: 'q_period' },
        { label: 'below', when: (c) => !bool(c, 'rent_income_above_threshold'), toNodeId: 'out_corporate_regime' },
      ],
    },
    q_period: {
      id: 'q_period',
      question: 'Is the current tax period still open?',
      edges: [
        { label: 'open', when: (c) => bool(c, 'tax_period_open'), toNodeId: 'q_arrears' },
        { label: 'closed', when: (c) => !bool(c, 'tax_period_open'), toNodeId: 'out_late_filing' },
      ],
    },
    q_arrears: {
      id: 'q_arrears',
      question: 'Is there an outstanding KRA balance?',
      edges: [
        { label: 'yes', when: (c) => bool(c, 'has_arrears_owing'), toNodeId: 'out_settle_then_file' },
        { label: 'no', when: (c) => !bool(c, 'has_arrears_owing'), toNodeId: 'out_file_mri' },
      ],
    },
    out_not_applicable: { id: 'out_not_applicable', question: '', outcome: 'not-applicable' },
    out_register_pin: { id: 'out_register_pin', question: '', outcome: 'register-pin' },
    out_corporate_regime: { id: 'out_corporate_regime', question: '', outcome: 'corporate-regime' },
    out_late_filing: { id: 'out_late_filing', question: '', outcome: 'late-filing-process' },
    out_settle_then_file: { id: 'out_settle_then_file', question: '', outcome: 'settle-arrears-then-file-mri' },
    out_file_mri: { id: 'out_file_mri', question: '', outcome: 'file-mri' },
  },
};
