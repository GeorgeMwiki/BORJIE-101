/**
 * Tender response.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  rfpNumber: z.string().min(1).max(60),
  bidder: z.string().min(1).max(160),
  coverLetter: z.string().min(1),
  technicalProposal: z.string().min(1),
  commercialProposal: z.string().min(1),
  complianceMatrix: z.array(z.object({
    requirement: z.string().min(1).max(240),
    compliant: z.boolean(),
    note: z.string().max(240).optional(),
  })).min(1).max(40),
  signatoryName: z.string().min(1).max(120),
  signatoryTitle: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const tenderResponseTemplate: UniversalTemplate = {
  id: 'tender-response',
  title: { en: 'Tender Response', sw: 'Jibu la Tenda' },
  kind: 'rfp_response',
  description: 'Tender response.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const matrix = v.complianceMatrix
      .map((row) => `| ${row.requirement} | ${row.compliant ? 'YES' : 'NO'} | ${row.note ?? ''} |`)
      .join('\n');
    return [
      `# ${lang === 'sw' ? 'JIBU LA TENDA' : 'TENDER RESPONSE'}`,
      `## ${lang === 'sw' ? 'Kumb' : 'Ref'}: ${v.rfpNumber}`,
      '',
      `**${lang === 'sw' ? 'Mwombaji' : 'Bidder'}:** ${v.bidder}`,
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      '',
      `## ${lang === 'sw' ? '1. Barua ya Jalada' : '1. Cover Letter'}`,
      '',
      v.coverLetter,
      '',
      `## ${lang === 'sw' ? '2. Pendekezo la Kiufundi' : '2. Technical Proposal'}`,
      '',
      v.technicalProposal,
      '',
      `## ${lang === 'sw' ? '3. Pendekezo la Kibiashara' : '3. Commercial Proposal'}`,
      '',
      v.commercialProposal,
      '',
      `## ${lang === 'sw' ? '4. Jedwali la Utiifu' : '4. Compliance Matrix'}`,
      '',
      `| ${lang === 'sw' ? 'Hitaji' : 'Requirement'} | ${lang === 'sw' ? 'Inafikia' : 'Compliant'} | ${lang === 'sw' ? 'Maelezo' : 'Note'} |`,
      `| --- | --- | --- |`,
      matrix,
      '',
      `${v.signatoryName}`,
      `${v.signatoryTitle}`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
