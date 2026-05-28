/**
 * Employment offer letter.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  candidateName: z.string().min(1).max(120),
  candidateAddress: z.string().min(1).max(240).optional(),
  role: z.string().min(1).max(120),
  startDate: z.string().min(1).max(40),
  salaryGrossTzs: z.string().min(1).max(60),
  benefits: z.array(z.string().min(1).max(160)).min(1).max(10),
  probationMonths: z.number().int().min(0).max(12).default(3),
  responseDeadline: z.string().min(1).max(40),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const employmentOfferLetterTemplate: UniversalTemplate = {
  id: 'employment-offer-letter',
  title: { en: 'Employment Offer Letter', sw: 'Barua ya Toleo la Ajira' },
  kind: 'letter',
  description: 'Employment offer letter.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${lang === 'sw' ? 'BARUA YA TOLEO LA AJIRA' : 'EMPLOYMENT OFFER LETTER'}`,
      '',
      `${v.candidateName}`,
      v.candidateAddress ? v.candidateAddress : '',
      '',
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      '',
      `${lang === 'sw' ? `Tunafurahi kukutoa toleo la ajira la kuwa ${v.role}.` : `We are pleased to offer you the role of ${v.role}.`}`,
      '',
      `## ${lang === 'sw' ? '1. Masharti Muhimu' : '1. Key Terms'}`,
      '',
      `- ${lang === 'sw' ? 'Tarehe ya Kuanza' : 'Start Date'}: ${v.startDate}`,
      `- ${lang === 'sw' ? 'Mshahara wa Gharama' : 'Gross Salary'}: ${v.salaryGrossTzs}`,
      `- ${lang === 'sw' ? 'Kipindi cha Majaribio' : 'Probation Period'}: ${v.probationMonths} ${lang === 'sw' ? 'miezi' : 'months'}`,
      '',
      `## ${lang === 'sw' ? '2. Faida' : '2. Benefits'}`,
      '',
      v.benefits.map((b) => `- ${b}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '3. Jibu' : '3. Acceptance'}`,
      '',
      `${lang === 'sw' ? `Tafadhali kubali toleo hili kwa kusaini na kurudisha kabla ya ${v.responseDeadline}.` : `Please accept this offer by signing and returning by ${v.responseDeadline}.`}`,
      '',
      `${lang === 'sw' ? 'Karibu sana' : 'Warm regards'},`,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
