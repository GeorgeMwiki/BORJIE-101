/**
 * Supplier communications letter.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  supplierName: z.string().min(1).max(120),
  supplierAddress: z.string().min(1).max(240).optional(),
  contactPerson: z.string().min(1).max(120).optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  nextSteps: z.string().min(1).max(400).optional(),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const letterSupplierTemplate: UniversalTemplate = {
  id: 'letter-supplier',
  title: { en: 'Letter to Supplier', sw: 'Barua kwa Msambazaji' },
  kind: 'letter',
  description: 'Supplier communications letter.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const contact = v.contactPerson ? `\nAttn: ${v.contactPerson}` : '';
    const addr = v.supplierAddress ? `\n${v.supplierAddress}` : '';
    const next = v.nextSteps
      ? `\n\n### ${lang === 'sw' ? 'Hatua Zinazofuata' : 'Next Steps'}\n\n${v.nextSteps.trim()}`
      : '';
    return [
      `# ${lang === 'sw' ? 'BARUA KWA MSAMBAZAJI' : 'LETTER TO SUPPLIER'}`,
      '',
      `${v.supplierName}${addr}${contact}`,
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      '',
      `**${lang === 'sw' ? 'Kuhusu' : 'Subject'}:** ${v.subject}`,
      '',
      v.body.trim(),
      next,
      '',
      `${lang === 'sw' ? 'Wako wa kweli' : 'Yours sincerely'},`,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true },
};
