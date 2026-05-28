/**
 * Training module outline.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  moduleTitle: z.string().min(1).max(160),
  targetAudience: z.string().min(1).max(240),
  learningObjectives: z.array(z.string().min(1).max(240)).min(2).max(10),
  durationHours: z.number().min(0.25).max(80),
  sessions: z.array(z.object({
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(400),
    activities: z.array(z.string().min(1).max(200)).min(1).max(8),
  })).min(1).max(15),
  assessment: z.string().min(1),
  facilitator: z.string().min(1).max(120),
});

export const trainingMaterialTemplate: UniversalTemplate = {
  id: 'training-material',
  title: { en: 'Training Material', sw: 'Mwongozo wa Mafunzo' },
  kind: 'memo',
  description: 'Training module outline.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const out: string[] = [];
    out.push(`# ${v.moduleTitle}`);
    out.push(`## ${lang === 'sw' ? 'Mwongozo wa Mafunzo' : 'Training Module'}`);
    out.push('');
    out.push(`**${lang === 'sw' ? 'Hadhira' : 'Audience'}:** ${v.targetAudience}`);
    out.push(`**${lang === 'sw' ? 'Muda' : 'Duration'}:** ${v.durationHours} ${lang === 'sw' ? 'saa' : 'hours'}`);
    out.push(`**${lang === 'sw' ? 'Mwezeshaji' : 'Facilitator'}:** ${v.facilitator}`);
    out.push('');
    out.push(`## ${lang === 'sw' ? 'Malengo ya Kujifunza' : 'Learning Objectives'}`);
    out.push('');
    out.push(v.learningObjectives.map((o, i) => `${i + 1}. ${o}`).join('\n'));
    out.push('');
    out.push(`## ${lang === 'sw' ? 'Vipindi' : 'Sessions'}`);
    out.push('');
    v.sessions.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.title}`);
      out.push('');
      out.push(s.summary);
      out.push('');
      out.push(`**${lang === 'sw' ? 'Shughuli' : 'Activities'}:**`);
      out.push(s.activities.map((a) => `- ${a}`).join('\n'));
      out.push('');
    });
    out.push(`## ${lang === 'sw' ? 'Tathmini' : 'Assessment'}`);
    out.push('');
    out.push(v.assessment);
    return out.join('\n');
  },
  renderHints: { classification: 'internal', headerLogo: true, preferredFormat: 'pptx' },
};
