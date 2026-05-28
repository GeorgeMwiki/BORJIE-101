/**
 * Standard Operating Procedure — blast safety (canonical example).
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  sopNumber: z.string().min(1).max(60),
  effectiveDate: z.string().min(1).max(40),
  owner: z.string().min(1).max(160),
  scope: z.string().min(1),
  preBlastChecklist: z.array(z.string().min(1).max(240)).min(3).max(20),
  blastSequence: z.array(z.string().min(1).max(240)).min(3).max(20),
  postBlastChecklist: z.array(z.string().min(1).max(240)).min(2).max(20),
  emergencyProcedure: z.string().min(1),
  rolesResponsibilities: z.string().min(1),
  trainingRequirements: z.string().min(1),
  reviewedBy: z.string().min(1).max(120),
  approvedBy: z.string().min(1).max(120),
});

export const sopBlastSafetyTemplate: UniversalTemplate = {
  id: 'sop-blast-safety',
  title: {
    en: 'SOP — Blast Safety',
    sw: 'Utaratibu wa Kawaida — Usalama wa Mlipuko',
  },
  kind: 'memo',
  description: 'Standard Operating Procedure — blast safety (canonical example).',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const sections = [
      ['Scope', v.scope, v.scope],
      ['Pre-Blast Checklist', null, null],
      ['Blast Sequence', null, null],
      ['Post-Blast Checklist', null, null],
      ['Emergency Procedure', v.emergencyProcedure, v.emergencyProcedure],
      ['Roles & Responsibilities', v.rolesResponsibilities, v.rolesResponsibilities],
      ['Training Requirements', v.trainingRequirements, v.trainingRequirements],
    ];
    const out: string[] = [];
    out.push(`# ${lang === 'sw' ? 'UTARATIBU WA KAWAIDA WA UENDESHAJI' : 'STANDARD OPERATING PROCEDURE'}`);
    out.push(`## ${lang === 'sw' ? 'Usalama wa Mlipuko' : 'Blast Safety'}`);
    out.push('');
    out.push(`**SOP #:** ${v.sopNumber}`);
    out.push(`**${lang === 'sw' ? 'Tarehe ya Kuanza' : 'Effective Date'}:** ${v.effectiveDate}`);
    out.push(`**${lang === 'sw' ? 'Mmiliki' : 'Owner'}:** ${v.owner}`);
    out.push('');
    out.push(`## 1. ${lang === 'sw' ? 'Mawanda' : 'Scope'}`);
    out.push('');
    out.push(v.scope);
    out.push('');
    out.push(`## 2. ${lang === 'sw' ? 'Hatua Kabla ya Mlipuko' : 'Pre-Blast Checklist'}`);
    out.push('');
    out.push(v.preBlastChecklist.map((s, i) => `${i + 1}. ${s}`).join('\n'));
    out.push('');
    out.push(`## 3. ${lang === 'sw' ? 'Mfululizo wa Mlipuko' : 'Blast Sequence'}`);
    out.push('');
    out.push(v.blastSequence.map((s, i) => `${i + 1}. ${s}`).join('\n'));
    out.push('');
    out.push(`## 4. ${lang === 'sw' ? 'Hatua Baada ya Mlipuko' : 'Post-Blast Checklist'}`);
    out.push('');
    out.push(v.postBlastChecklist.map((s, i) => `${i + 1}. ${s}`).join('\n'));
    out.push('');
    out.push(`## 5. ${lang === 'sw' ? 'Utaratibu wa Dharura' : 'Emergency Procedure'}`);
    out.push('');
    out.push(v.emergencyProcedure);
    out.push('');
    out.push(`## 6. ${lang === 'sw' ? 'Majukumu' : 'Roles & Responsibilities'}`);
    out.push('');
    out.push(v.rolesResponsibilities);
    out.push('');
    out.push(`## 7. ${lang === 'sw' ? 'Mahitaji ya Mafunzo' : 'Training Requirements'}`);
    out.push('');
    out.push(v.trainingRequirements);
    out.push('');
    out.push(`---`);
    out.push(`Reviewed by: ${v.reviewedBy} | Approved by: ${v.approvedBy}`);
    void sections;
    return out.join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true, preferredFormat: 'pdf' },
};
