/**
 * 8-section mining-estate business plan.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  companyName: z.string().min(1).max(160),
  planHorizonYears: z.number().int().min(1).max(20).default(5),
  executiveSummary: z.string().min(1),
  marketOpportunity: z.string().min(1),
  operations: z.string().min(1),
  geologyAndReserves: z.string().min(1),
  team: z.string().min(1),
  financials: z.string().min(1),
  risks: z.string().min(1),
  ask: z.string().min(1),
});

export const businessPlanTemplate: UniversalTemplate = {
  id: 'business-plan',
  title: {
    en: 'Mining Estate Business Plan',
    sw: 'Mpango wa Biashara wa Mali ya Madini',
  },
  kind: 'memo',
  description: '8-section mining-estate business plan.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const horizon = lang === 'sw' ? `Miaka ${v.planHorizonYears}` : `${v.planHorizonYears}-Year Horizon`;
    const sections = lang === 'sw'
      ? [
          ['Muhtasari wa Utawala', v.executiveSummary],
          ['Fursa ya Soko', v.marketOpportunity],
          ['Uendeshaji', v.operations],
          ['Jiolojia na Akiba', v.geologyAndReserves],
          ['Timu', v.team],
          ['Fedha', v.financials],
          ['Hatari', v.risks],
          ['Mahitaji', v.ask],
        ]
      : [
          ['Executive Summary', v.executiveSummary],
          ['Market Opportunity', v.marketOpportunity],
          ['Operations', v.operations],
          ['Geology and Reserves', v.geologyAndReserves],
          ['Team', v.team],
          ['Financials', v.financials],
          ['Risks', v.risks],
          ['Ask', v.ask],
        ];
    const out = [
      `# ${v.companyName}`,
      `## ${lang === 'sw' ? 'Mpango wa Biashara' : 'Business Plan'} (${horizon})`,
      '',
    ];
    sections.forEach((entry, i) => {
      const heading = entry[0] ?? '';
      const body = entry[1] ?? '';
      out.push(`## ${i + 1}. ${heading}`);
      out.push('');
      out.push(body);
      out.push('');
    });
    return out.join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true, coverPage: true, preferredFormat: 'pdf' },
};
