/**
 * RFP for equipment / services.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  rfpNumber: z.string().min(1).max(60),
  issuer: z.string().min(1).max(160),
  scope: z.string().min(1),
  technicalRequirements: z.array(z.string().min(1).max(240)).min(1).max(20),
  commercialRequirements: z.array(z.string().min(1).max(240)).min(1).max(10),
  evaluationCriteria: z.string().min(1),
  submissionDeadline: z.string().min(1).max(80),
  submissionAddress: z.string().min(1).max(240),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().min(1).max(120),
});

export const rfpEquipmentTemplate: UniversalTemplate = {
  id: 'rfp-equipment',
  title: { en: 'RFP for Equipment / Services', sw: 'Ombi la Tume la Vifaa / Huduma' },
  kind: 'rfp',
  description: 'RFP for equipment / services.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    return [
      `# ${lang === 'sw' ? 'OMBI LA TUME (RFP)' : 'REQUEST FOR PROPOSAL (RFP)'}`,
      `## ${v.rfpNumber}`,
      '',
      `**${lang === 'sw' ? 'Mtoaji' : 'Issuer'}:** ${v.issuer}`,
      '',
      `## ${lang === 'sw' ? '1. Mawanda' : '1. Scope'}`,
      '',
      v.scope,
      '',
      `## ${lang === 'sw' ? '2. Mahitaji ya Kiufundi' : '2. Technical Requirements'}`,
      '',
      v.technicalRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '3. Mahitaji ya Kibiashara' : '3. Commercial Requirements'}`,
      '',
      v.commercialRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '4. Vigezo vya Tathmini' : '4. Evaluation Criteria'}`,
      '',
      v.evaluationCriteria,
      '',
      `## ${lang === 'sw' ? '5. Mawasilisho' : '5. Submission'}`,
      '',
      `**${lang === 'sw' ? 'Tarehe ya Mwisho' : 'Deadline'}:** ${v.submissionDeadline}`,
      `**${lang === 'sw' ? 'Anwani' : 'Address'}:** ${v.submissionAddress}`,
      `**${lang === 'sw' ? 'Mawasiliano' : 'Contact'}:** ${v.contactName} | ${v.contactEmail}`,
    ].join('\n');
  },
  renderHints: { classification: 'public', headerLogo: true },
};
