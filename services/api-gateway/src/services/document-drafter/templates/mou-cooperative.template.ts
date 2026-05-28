/**
 * MOU with a cooperative / community group.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  partyA: z.string().min(1).max(160),
  partyB: z.string().min(1).max(160),
  purpose: z.string().min(1).max(400),
  scopeOfCooperation: z.string().min(1),
  duration: z.string().min(1).max(120),
  obligationsA: z.array(z.string().min(1).max(240)).min(1).max(10),
  obligationsB: z.array(z.string().min(1).max(240)).min(1).max(10),
  governingLaw: z.string().min(1).max(120).optional(),
  signatoryA: z.string().min(1).max(120),
  signatoryB: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const mouCooperativeTemplate: UniversalTemplate = {
  id: 'mou-cooperative',
  title: {
    en: 'MOU — Cooperative Partnership',
    sw: 'Makubaliano ya Maelewano — Ushirika',
  },
  kind: 'contract',
  description: 'MOU with a cooperative or community group.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const law = v.governingLaw ?? 'Laws of the United Republic of Tanzania';
    return [
      `# ${lang === 'sw' ? 'MAKUBALIANO YA MAELEWANO (MOU)' : 'MEMORANDUM OF UNDERSTANDING (MOU)'}`,
      '',
      `**${lang === 'sw' ? 'Kati ya' : 'Between'}:** ${v.partyA}`,
      `**${lang === 'sw' ? 'Na' : 'And'}:** ${v.partyB}`,
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      '',
      `## ${lang === 'sw' ? '1. Madhumuni' : '1. Purpose'}`,
      '',
      v.purpose,
      '',
      `## ${lang === 'sw' ? '2. Mawanda ya Ushirikiano' : '2. Scope of Cooperation'}`,
      '',
      v.scopeOfCooperation,
      '',
      `## ${lang === 'sw' ? '3. Muda' : '3. Duration'}`,
      '',
      v.duration,
      '',
      `## ${lang === 'sw' ? `4. Wajibu wa ${v.partyA}` : `4. Obligations of ${v.partyA}`}`,
      '',
      v.obligationsA.map((o, i) => `${i + 1}. ${o}`).join('\n'),
      '',
      `## ${lang === 'sw' ? `5. Wajibu wa ${v.partyB}` : `5. Obligations of ${v.partyB}`}`,
      '',
      v.obligationsB.map((o, i) => `${i + 1}. ${o}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '6. Sheria Inayoongoza' : '6. Governing Law'}`,
      '',
      law,
      '',
      `## ${lang === 'sw' ? '7. Sahihi' : '7. Signatures'}`,
      '',
      `${v.partyA}: ____________________   ${v.signatoryA}`,
      '',
      `${v.partyB}: ____________________   ${v.signatoryB}`,
    ].join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true, coverPage: false },
};
