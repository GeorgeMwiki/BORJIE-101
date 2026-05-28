/**
 * Internal audit report.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  scope: z.string().min(1).max(240),
  period: z.string().min(1).max(80),
  objectives: z.array(z.string().min(1).max(240)).min(1).max(8),
  findings: z.array(z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string().min(1).max(160),
    detail: z.string().min(1),
    recommendation: z.string().min(1),
  })).min(1).max(20),
  managementResponseRequired: z.boolean().default(true),
  auditor: z.string().min(1).max(120),
  date: z.string().min(1).max(40).optional(),
});

export const auditReportInternalTemplate: UniversalTemplate = {
  id: 'audit-report-internal',
  title: { en: 'Internal Audit Report', sw: 'Ripoti ya Ukaguzi wa Ndani' },
  kind: 'memo',
  description: 'Internal audit report.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.date ?? new Date().toISOString().slice(0, 10);
    const out: string[] = [];
    out.push(`# ${lang === 'sw' ? 'RIPOTI YA UKAGUZI WA NDANI' : 'INTERNAL AUDIT REPORT'}`);
    out.push('');
    out.push(`**${lang === 'sw' ? 'Mawanda' : 'Scope'}:** ${v.scope}`);
    out.push(`**${lang === 'sw' ? 'Kipindi' : 'Period'}:** ${v.period}`);
    out.push(`**${lang === 'sw' ? 'Mkaguzi' : 'Auditor'}:** ${v.auditor}`);
    out.push(`**${lang === 'sw' ? 'Tarehe' : 'Date'}:** ${date}`);
    out.push('');
    out.push(`## ${lang === 'sw' ? '1. Malengo' : '1. Objectives'}`);
    out.push('');
    out.push(v.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n'));
    out.push('');
    out.push(`## ${lang === 'sw' ? '2. Matokeo' : '2. Findings'}`);
    out.push('');
    v.findings.forEach((f, i) => {
      out.push(`### ${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
      out.push('');
      out.push(f.detail);
      out.push('');
      out.push(`**${lang === 'sw' ? 'Pendekezo' : 'Recommendation'}:** ${f.recommendation}`);
      out.push('');
    });
    if (v.managementResponseRequired) {
      out.push(`## ${lang === 'sw' ? '3. Jibu la Uongozi (Linahitajika)' : '3. Management Response (Required)'}`);
      out.push('');
      out.push('_Pending_');
    }
    return out.join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true },
};
