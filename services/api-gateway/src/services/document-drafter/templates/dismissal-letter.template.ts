/**
 * Termination notice (LRA-compliant).
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  employeeName: z.string().min(1).max(120),
  employeeRole: z.string().min(1).max(120),
  groundsForDismissal: z.string().min(1),
  processFollowed: z.string().min(1),
  effectiveDate: z.string().min(1).max(40),
  noticePeriodDays: z.number().int().min(0).max(180),
  finalSettlementSummary: z.string().min(1),
  rightToAppeal: z.string().min(1).max(400),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const dismissalLetterTemplate: UniversalTemplate = {
  id: 'dismissal-letter',
  title: { en: 'Dismissal Letter', sw: 'Barua ya Kufutwa Kazi' },
  kind: 'letter',
  description: 'Termination notice (Tanzania Employment & Labour Relations Act compliant).',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${lang === 'sw' ? 'BARUA YA KUFUTWA KAZI' : 'TERMINATION NOTICE'}`,
      '',
      `${v.employeeName} (${v.employeeRole})`,
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      `**${lang === 'sw' ? 'Tarehe ya Kuanza Kutekelezwa' : 'Effective Date'}:** ${v.effectiveDate}`,
      `**${lang === 'sw' ? 'Muda wa Taarifa' : 'Notice Period'}:** ${v.noticePeriodDays} ${lang === 'sw' ? 'siku' : 'days'}`,
      '',
      `## ${lang === 'sw' ? '1. Sababu' : '1. Grounds'}`,
      '',
      v.groundsForDismissal,
      '',
      `## ${lang === 'sw' ? '2. Mchakato Ulivyofuata' : '2. Process Followed'}`,
      '',
      v.processFollowed,
      '',
      `## ${lang === 'sw' ? '3. Malipo ya Mwisho' : '3. Final Settlement'}`,
      '',
      v.finalSettlementSummary,
      '',
      `## ${lang === 'sw' ? '4. Haki ya Rufaa' : '4. Right to Appeal'}`,
      '',
      v.rightToAppeal,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
