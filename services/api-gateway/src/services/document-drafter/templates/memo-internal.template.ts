/**
 * Internal memo template — To/From/Re/Date/Body. Bilingual.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  to: z.string().min(1).max(120),
  from: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  date: z.string().min(1).max(40).optional(),
  body: z.string().min(1),
  classification: z.enum(['public', 'internal', 'confidential']).optional(),
});

export const memoInternalTemplate: UniversalTemplate = {
  id: 'memo-internal',
  title: { en: 'Internal Memo', sw: 'Memo ya Ndani' },
  kind: 'memo',
  description: 'Internal memo (To / From / Re / Date / Body).',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const labels =
      lang === 'sw'
        ? { to: 'Kwa', from: 'Kutoka', re: 'Kuhusu', date: 'Tarehe' }
        : { to: 'To', from: 'From', re: 'Re', date: 'Date' };
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${lang === 'sw' ? 'MEMO YA NDANI' : 'INTERNAL MEMO'}`,
      '',
      `**${labels.to}:** ${v.to}`,
      `**${labels.from}:** ${v.from}`,
      `**${labels.re}:** ${v.subject}`,
      `**${labels.date}:** ${date}`,
      '',
      '---',
      '',
      v.body.trim(),
    ].join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true },
};
