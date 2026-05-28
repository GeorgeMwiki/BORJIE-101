/**
 * Board resolution — Whereas / Resolved that / Signed.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  companyName: z.string().min(1).max(160),
  resolutionNumber: z.string().min(1).max(40),
  meetingDate: z.string().min(1).max(40),
  whereasClauses: z.array(z.string().min(1).max(400)).min(1).max(10),
  resolvedClauses: z.array(z.string().min(1).max(400)).min(1).max(10),
  chairperson: z.string().min(1).max(120),
  secretary: z.string().min(1).max(120),
});

export const boardResolutionTemplate: UniversalTemplate = {
  id: 'board-resolution',
  title: { en: 'Board Resolution', sw: 'Azimio la Bodi' },
  kind: 'memo',
  description: 'Formal board resolution (Whereas / Resolved that / Signed).',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const whereasHeading = lang === 'sw' ? 'KWA KUWA' : 'WHEREAS';
    const resolvedHeading = lang === 'sw' ? 'IMEAZIMIWA KUWA' : 'RESOLVED THAT';
    return [
      `# ${lang === 'sw' ? 'AZIMIO LA BODI' : 'BOARD RESOLUTION'}`,
      `## ${v.companyName}`,
      '',
      `**${lang === 'sw' ? 'Nambari ya Azimio' : 'Resolution No'}:** ${v.resolutionNumber}`,
      `**${lang === 'sw' ? 'Tarehe ya Kikao' : 'Meeting Date'}:** ${v.meetingDate}`,
      '',
      `### ${whereasHeading}`,
      '',
      v.whereasClauses.map((c) => `- ${c}`).join('\n'),
      '',
      `### ${resolvedHeading}`,
      '',
      v.resolvedClauses.map((c, i) => `${i + 1}. ${c}`).join('\n'),
      '',
      `**${lang === 'sw' ? 'Mwenyekiti' : 'Chairperson'}:** ${v.chairperson}`,
      '',
      `**${lang === 'sw' ? 'Katibu' : 'Secretary'}:** ${v.secretary}`,
      '',
      `Signed: ____________________   Date: ____________________`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
