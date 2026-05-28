/**
 * Off-taker / buyer communications letter.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  buyerName: z.string().min(1).max(120),
  buyerAddress: z.string().min(1).max(240).optional(),
  mineral: z.string().min(1).max(60),
  parcelReference: z.string().min(1).max(60).optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  commercialTerms: z.string().min(1).max(400).optional(),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const letterBuyerTemplate: UniversalTemplate = {
  id: 'letter-buyer',
  title: { en: 'Letter to Off-Taker', sw: 'Barua kwa Mnunuzi' },
  kind: 'letter',
  description: 'Off-taker / buyer communications letter.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const addr = v.buyerAddress ? `\n${v.buyerAddress}` : '';
    const parcel = v.parcelReference
      ? `\n**${lang === 'sw' ? 'Kumb ya Mzigo' : 'Parcel Ref'}:** ${v.parcelReference}`
      : '';
    const terms = v.commercialTerms
      ? `\n\n### ${lang === 'sw' ? 'Masharti ya Kibiashara' : 'Commercial Terms'}\n\n${v.commercialTerms.trim()}`
      : '';
    return [
      `# ${lang === 'sw' ? 'BARUA KWA MNUNUZI' : 'LETTER TO OFF-TAKER'}`,
      '',
      `${v.buyerName}${addr}`,
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      `**${lang === 'sw' ? 'Madini' : 'Mineral'}:** ${v.mineral}${parcel}`,
      '',
      `**${lang === 'sw' ? 'Kuhusu' : 'Subject'}:** ${v.subject}`,
      '',
      v.body.trim(),
      terms,
      '',
      `${lang === 'sw' ? 'Karibu kwa biashara' : 'Yours sincerely'},`,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
