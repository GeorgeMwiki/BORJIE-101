/**
 * Community Development Agreement (per Mining Local Content Regs).
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  companyName: z.string().min(1).max(160),
  communityName: z.string().min(1).max(160),
  pmlOrLicenceNumber: z.string().min(1).max(60),
  totalCommitmentTzs: z.string().min(1).max(60),
  durationYears: z.number().int().min(1).max(30).default(5),
  pillars: z.array(z.string().min(1).max(160)).min(1).max(8),
  governanceCommittee: z.string().min(1).max(400),
  monitoringRegime: z.string().min(1),
  signatoryCompany: z.string().min(1).max(120),
  signatoryCommunity: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const cdaCommunityTemplate: UniversalTemplate = {
  id: 'cda-community',
  title: {
    en: 'Community Development Agreement (CDA)',
    sw: 'Mkataba wa Maendeleo ya Jamii (CDA)',
  },
  kind: 'contract',
  description: 'Community Development Agreement per Mining Local Content Regs.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${lang === 'sw' ? 'MKATABA WA MAENDELEO YA JAMII (CDA)' : 'COMMUNITY DEVELOPMENT AGREEMENT (CDA)'}`,
      '',
      `**${lang === 'sw' ? 'Kati ya' : 'Between'}:** ${v.companyName}`,
      `**${lang === 'sw' ? 'Na' : 'And'}:** ${v.communityName}`,
      `**${lang === 'sw' ? 'Leseni / PML' : 'Licence / PML'}:** ${v.pmlOrLicenceNumber}`,
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      '',
      `## ${lang === 'sw' ? '1. Jumla ya Ahadi' : '1. Total Commitment'}`,
      '',
      `${v.totalCommitmentTzs} ${lang === 'sw' ? 'kwa kipindi cha miaka' : 'over a period of'} ${v.durationYears} ${lang === 'sw' ? '' : 'years'}`,
      '',
      `## ${lang === 'sw' ? '2. Nguzo za Uwekezaji' : '2. Investment Pillars'}`,
      '',
      v.pillars.map((p, i) => `${i + 1}. ${p}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '3. Kamati ya Usimamizi' : '3. Governance Committee'}`,
      '',
      v.governanceCommittee,
      '',
      `## ${lang === 'sw' ? '4. Ufuatiliaji na Tathmini' : '4. Monitoring & Evaluation'}`,
      '',
      v.monitoringRegime,
      '',
      `## ${lang === 'sw' ? '5. Sahihi' : '5. Signatures'}`,
      '',
      `${v.companyName}: ${v.signatoryCompany}`,
      '',
      `${v.communityName}: ${v.signatoryCommunity}`,
    ].join('\n');
  },
  renderHints: { classification: 'public', headerLogo: true, coverPage: true },
};
