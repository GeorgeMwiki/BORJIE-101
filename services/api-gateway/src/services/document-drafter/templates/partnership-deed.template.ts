/**
 * JV / partnership deed.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  partyA: z.string().min(1).max(160),
  partyB: z.string().min(1).max(160),
  ventureName: z.string().min(1).max(160),
  contributionA: z.string().min(1).max(400),
  contributionB: z.string().min(1).max(400),
  profitShareA: z.string().min(1).max(60),
  profitShareB: z.string().min(1).max(60),
  managementTerms: z.string().min(1),
  dispute: z.string().min(1).max(400).optional(),
  governingLaw: z.string().min(1).max(120).optional(),
  date: z.string().min(1).max(40).optional(),
});

export const partnershipDeedTemplate: UniversalTemplate = {
  id: 'partnership-deed',
  title: { en: 'Partnership Deed', sw: 'Hati ya Ubia' },
  kind: 'contract',
  description: 'JV / partnership deed.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const law = v.governingLaw ?? 'Laws of the United Republic of Tanzania';
    const dispute = v.dispute ?? 'Disputes shall first be resolved by amicable negotiation, failing which the parties shall refer the matter to mediation under the Tanzania Institute of Arbitrators.';
    return [
      `# ${lang === 'sw' ? 'HATI YA UBIA (PARTNERSHIP DEED)' : 'PARTNERSHIP DEED'}`,
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      `**${lang === 'sw' ? 'Jina la Ubia' : 'Venture Name'}:** ${v.ventureName}`,
      '',
      `**${lang === 'sw' ? 'Mshirika A' : 'Partner A'}:** ${v.partyA}`,
      `**${lang === 'sw' ? 'Mshirika B' : 'Partner B'}:** ${v.partyB}`,
      '',
      `## ${lang === 'sw' ? '1. Michango' : '1. Contributions'}`,
      '',
      `**${v.partyA}:** ${v.contributionA}`,
      '',
      `**${v.partyB}:** ${v.contributionB}`,
      '',
      `## ${lang === 'sw' ? '2. Mgawanyo wa Faida' : '2. Profit Share'}`,
      '',
      `${v.partyA}: ${v.profitShareA}`,
      '',
      `${v.partyB}: ${v.profitShareB}`,
      '',
      `## ${lang === 'sw' ? '3. Uongozi' : '3. Management'}`,
      '',
      v.managementTerms,
      '',
      `## ${lang === 'sw' ? '4. Migogoro' : '4. Disputes'}`,
      '',
      dispute,
      '',
      `## ${lang === 'sw' ? '5. Sheria Inayoongoza' : '5. Governing Law'}`,
      '',
      law,
      '',
      `## ${lang === 'sw' ? '6. Sahihi' : '6. Signatures'}`,
      '',
      `${v.partyA}: ____________________`,
      '',
      `${v.partyB}: ____________________`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true, coverPage: true },
};
