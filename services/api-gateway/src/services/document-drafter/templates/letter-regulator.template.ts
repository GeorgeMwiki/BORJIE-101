/**
 * Generic regulator letter — TRA / NEMC / BoT / Mining Commission.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  regulator: z.enum(['tra', 'nemc', 'bot', 'mining-commission', 'brela', 'other']),
  regulatorDisplayName: z.string().min(1).max(160),
  subject: z.string().min(1).max(200),
  ourReference: z.string().min(1).max(60).optional(),
  body: z.string().min(1),
  requestedAction: z.string().min(1).max(400).optional(),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const letterRegulatorTemplate: UniversalTemplate = {
  id: 'letter-regulator',
  title: { en: 'Letter to Regulator', sw: 'Barua kwa Mdhibiti' },
  kind: 'letter',
  description: 'Generic regulator letter (TRA / NEMC / BoT / Mining Commission).',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const ref = v.ourReference ? `\n**${lang === 'sw' ? 'Kumb' : 'Our Ref'}:** ${v.ourReference}` : '';
    const action = v.requestedAction
      ? `\n\n### ${lang === 'sw' ? 'Hatua Inayoombwa' : 'Requested Action'}\n\n${v.requestedAction.trim()}`
      : '';
    const heading = lang === 'sw' ? 'BARUA RASMI' : 'OFFICIAL LETTER';
    return [
      `# ${heading}`,
      '',
      `${v.regulatorDisplayName}`,
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}${ref}`,
      '',
      `**${lang === 'sw' ? 'Kuhusu' : 'Subject'}:** ${v.subject}`,
      '',
      v.body.trim(),
      action,
      '',
      `${lang === 'sw' ? 'Wako wa heshima' : 'Yours faithfully'},`,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true },
};
