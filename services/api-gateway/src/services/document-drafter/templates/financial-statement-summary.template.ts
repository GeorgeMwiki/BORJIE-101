/**
 * Financial statement summary — P&L + cash flow + balance-sheet narrative.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  companyName: z.string().min(1).max(160),
  period: z.string().min(1).max(80),
  reportingCurrency: z.string().min(2).max(8),
  pnlNarrative: z.string().min(1),
  cashFlowNarrative: z.string().min(1),
  balanceSheetNarrative: z.string().min(1),
  preparedBy: z.string().min(1).max(120),
  preparedAt: z.string().min(1).max(40).optional(),
});

export const financialStatementSummaryTemplate: UniversalTemplate = {
  id: 'financial-statement-summary',
  title: {
    en: 'Financial Statement Summary',
    sw: 'Muhtasari wa Taarifa za Fedha',
  },
  kind: 'memo',
  description: 'P&L + cash flow + balance-sheet narrative summary.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.preparedAt ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${v.companyName}`,
      `## ${lang === 'sw' ? 'Muhtasari wa Taarifa za Fedha' : 'Financial Statement Summary'}`,
      `**${lang === 'sw' ? 'Kipindi' : 'Period'}:** ${v.period}`,
      `**${lang === 'sw' ? 'Sarafu ya Kuripoti' : 'Reporting Currency'}:** ${v.reportingCurrency}`,
      `**${lang === 'sw' ? 'Imetayarishwa na' : 'Prepared by'}:** ${v.preparedBy} (${date})`,
      '',
      `## 1. ${lang === 'sw' ? 'Mapato na Matumizi (P&L)' : 'Profit & Loss'}`,
      '',
      v.pnlNarrative,
      '',
      `## 2. ${lang === 'sw' ? 'Mtiririko wa Fedha' : 'Cash Flow'}`,
      '',
      v.cashFlowNarrative,
      '',
      `## 3. ${lang === 'sw' ? 'Mizania' : 'Balance Sheet'}`,
      '',
      v.balanceSheetNarrative,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
