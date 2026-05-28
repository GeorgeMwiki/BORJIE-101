/**
 * Sponsorship / CSR pitch.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  sponsorTargetName: z.string().min(1).max(160),
  programName: z.string().min(1).max(160),
  programDescription: z.string().min(1),
  audienceReach: z.string().min(1).max(120),
  askAmountTzs: z.string().min(1).max(60),
  deliverables: z.array(z.string().min(1).max(240)).min(1).max(10),
  brandBenefits: z.string().min(1),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().min(1).max(120),
});

export const sponsorshipProposalTemplate: UniversalTemplate = {
  id: 'sponsorship-proposal',
  title: { en: 'Sponsorship Proposal', sw: 'Pendekezo la Udhamini' },
  kind: 'rfp',
  description: 'Sponsorship / CSR pitch.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    return [
      `# ${lang === 'sw' ? 'PENDEKEZO LA UDHAMINI' : 'SPONSORSHIP PROPOSAL'}`,
      `## ${v.programName}`,
      '',
      `**${lang === 'sw' ? 'Kwa' : 'To'}:** ${v.sponsorTargetName}`,
      '',
      `### ${lang === 'sw' ? '1. Maelezo ya Mpango' : '1. Programme Description'}`,
      '',
      v.programDescription,
      '',
      `### ${lang === 'sw' ? '2. Ufikiaji wa Hadhira' : '2. Audience Reach'}`,
      '',
      v.audienceReach,
      '',
      `### ${lang === 'sw' ? '3. Ombi la Udhamini' : '3. Sponsorship Ask'}`,
      '',
      v.askAmountTzs,
      '',
      `### ${lang === 'sw' ? '4. Vitu vya Kutolewa' : '4. Deliverables'}`,
      '',
      v.deliverables.map((d, i) => `${i + 1}. ${d}`).join('\n'),
      '',
      `### ${lang === 'sw' ? '5. Faida za Chapa' : '5. Brand Benefits'}`,
      '',
      v.brandBenefits,
      '',
      `### ${lang === 'sw' ? '6. Mawasiliano' : '6. Contact'}`,
      '',
      `${v.contactName} | ${v.contactEmail}`,
    ].join('\n');
  },
  renderHints: { classification: 'public', headerLogo: true, coverPage: true, preferredFormat: 'pdf' },
};
