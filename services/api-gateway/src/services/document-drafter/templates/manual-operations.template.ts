/**
 * Operations manual section.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  manualTitle: z.string().min(1).max(160),
  sectionTitle: z.string().min(1).max(160),
  version: z.string().min(1).max(20),
  scope: z.string().min(1),
  procedures: z.array(z.object({
    step: z.string().min(1).max(160),
    detail: z.string().min(1),
  })).min(1).max(40),
  safetyNotes: z.string().min(1),
  references: z.array(z.string().min(1).max(240)).max(20).optional(),
  owner: z.string().min(1).max(120),
  effectiveDate: z.string().min(1).max(40),
});

export const manualOperationsTemplate: UniversalTemplate = {
  id: 'manual-operations',
  title: { en: 'Operations Manual', sw: 'Mwongozo wa Uendeshaji' },
  kind: 'memo',
  description: 'Operations manual section.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const out: string[] = [];
    out.push(`# ${v.manualTitle}`);
    out.push(`## ${v.sectionTitle}`);
    out.push('');
    out.push(`**${lang === 'sw' ? 'Toleo' : 'Version'}:** ${v.version}`);
    out.push(`**${lang === 'sw' ? 'Tarehe ya Kuanza' : 'Effective Date'}:** ${v.effectiveDate}`);
    out.push(`**${lang === 'sw' ? 'Mmiliki' : 'Owner'}:** ${v.owner}`);
    out.push('');
    out.push(`## 1. ${lang === 'sw' ? 'Mawanda' : 'Scope'}`);
    out.push('');
    out.push(v.scope);
    out.push('');
    out.push(`## 2. ${lang === 'sw' ? 'Utaratibu' : 'Procedures'}`);
    out.push('');
    v.procedures.forEach((p, i) => {
      out.push(`### ${i + 1}. ${p.step}`);
      out.push('');
      out.push(p.detail);
      out.push('');
    });
    out.push(`## 3. ${lang === 'sw' ? 'Maelekezo ya Usalama' : 'Safety Notes'}`);
    out.push('');
    out.push(v.safetyNotes);
    if (v.references && v.references.length > 0) {
      out.push('');
      out.push(`## 4. ${lang === 'sw' ? 'Marejeleo' : 'References'}`);
      out.push('');
      out.push(v.references.map((r, i) => `${i + 1}. ${r}`).join('\n'));
    }
    return out.join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true, preferredFormat: 'pdf' },
};
