/**
 * Supervisor / employee performance review.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  employeeName: z.string().min(1).max(120),
  employeeRole: z.string().min(1).max(120),
  reviewerName: z.string().min(1).max(120),
  reviewPeriod: z.string().min(1).max(80),
  achievements: z.array(z.string().min(1).max(240)).min(1).max(10),
  areasForImprovement: z.array(z.string().min(1).max(240)).min(1).max(10),
  overallRating: z.enum(['exceeds', 'meets', 'partial', 'below']),
  goalsNextPeriod: z.array(z.string().min(1).max(240)).min(1).max(10),
  date: z.string().min(1).max(40).optional(),
});

export const performanceReviewTemplate: UniversalTemplate = {
  id: 'performance-review',
  title: { en: 'Performance Review', sw: 'Tathmini ya Utendaji' },
  kind: 'memo',
  description: 'Supervisor / employee performance review.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    return [
      `# ${lang === 'sw' ? 'TATHMINI YA UTENDAJI' : 'PERFORMANCE REVIEW'}`,
      '',
      `**${lang === 'sw' ? 'Mfanyakazi' : 'Employee'}:** ${v.employeeName} (${v.employeeRole})`,
      `**${lang === 'sw' ? 'Mtathmini' : 'Reviewer'}:** ${v.reviewerName}`,
      `**${lang === 'sw' ? 'Kipindi' : 'Period'}:** ${v.reviewPeriod}`,
      `**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`,
      `**${lang === 'sw' ? 'Daraja la Jumla' : 'Overall Rating'}:** ${v.overallRating.toUpperCase()}`,
      '',
      `## ${lang === 'sw' ? '1. Mafanikio' : '1. Achievements'}`,
      '',
      v.achievements.map((a, i) => `${i + 1}. ${a}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '2. Maeneo ya Kuboresha' : '2. Areas for Improvement'}`,
      '',
      v.areasForImprovement.map((a, i) => `${i + 1}. ${a}`).join('\n'),
      '',
      `## ${lang === 'sw' ? '3. Malengo ya Kipindi Kijacho' : '3. Goals for Next Period'}`,
      '',
      v.goalsNextPeriod.map((g, i) => `${i + 1}. ${g}`).join('\n'),
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
