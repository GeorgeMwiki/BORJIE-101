/**
 * Finance domain skills:
 *  - skill.finance.draft_owner_statement — produce an owner statement given
 *    property rollup data + fee schedule
 *  - skill.finance.draft_arrears_notice  — stratify a tenant arrears list
 *    and produce notice drafts per stratum
 *
 * Both are deterministic — notice drafting delegates to the Swahili/English
 * templates so legal tone stays stable.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { draftNotice } from '../kenya/swahili-draft.js';

// ---------------------------------------------------------------------------
// skill.finance.draft_owner_statement
// ---------------------------------------------------------------------------

export const OwnerStatementParamsSchema = z.object({
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  properties: z.array(
    z.object({
      propertyId: z.string().min(1),
      propertyName: z.string().min(1),
      grossCollectedKes: z.number().nonnegative(),
      arrearsKes: z.number().nonnegative().default(0),
      expensesKes: z.number().nonnegative().default(0),
      mpesaFeesKes: z.number().nonnegative().default(0),
    })
  ),
  managementFeePct: z.number().min(0).max(0.5).default(0.08),
  /** MRI withheld by Borjie on the owner's behalf. */
  mriWithheldKes: z.number().nonnegative().default(0),
});

export interface OwnerStatementResult {
  ownerId: string;
  ownerName: string;
  period: string;
  lines: Array<{
    propertyId: string;
    propertyName: string;
    grossCollectedKes: number;
    expensesKes: number;
    managementFeeKes: number;
    mpesaFeesKes: number;
    netKes: number;
  }>;
  total: {
    grossKes: number;
    expensesKes: number;
    managementFeeKes: number;
    mpesaFeesKes: number;
    mriWithheldKes: number;
    netDisbursementKes: number;
  };
  arrearsKes: number;
  /** Rendered markdown-ish statement text. */
  rendered: string;
}

export function draftOwnerStatement(
  params: z.infer<typeof OwnerStatementParamsSchema>
): OwnerStatementResult {
  const lines = params.properties.map((p) => {
    const managementFeeKes = p.grossCollectedKes * params.managementFeePct;
    const netKes =
      p.grossCollectedKes - p.expensesKes - managementFeeKes - p.mpesaFeesKes;
    return {
      propertyId: p.propertyId,
      propertyName: p.propertyName,
      grossCollectedKes: p.grossCollectedKes,
      expensesKes: p.expensesKes,
      managementFeeKes,
      mpesaFeesKes: p.mpesaFeesKes,
      netKes,
    };
  });

  const arrearsKes = params.properties.reduce((s, p) => s + p.arrearsKes, 0);
  const grossKes = lines.reduce((s, l) => s + l.grossCollectedKes, 0);
  const expensesKes = lines.reduce((s, l) => s + l.expensesKes, 0);
  const managementFeeKes = lines.reduce((s, l) => s + l.managementFeeKes, 0);
  const mpesaFeesKes = lines.reduce((s, l) => s + l.mpesaFeesKes, 0);
  const netDisbursementKes =
    grossKes - expensesKes - managementFeeKes - mpesaFeesKes - params.mriWithheldKes;

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(n);

  const rendered = [
    `# Owner Statement — ${params.ownerName}`,
    `Period: ${params.period}`,
    '',
    '| Property | Gross | Expenses | Mgmt fee | M-Pesa fees | Net |',
    '|----------|-------|----------|----------|-------------|-----|',
    ...lines.map(
      (l) =>
        `| ${l.propertyName} | KES ${fmt(l.grossCollectedKes)} | ${fmt(l.expensesKes)} | ${fmt(l.managementFeeKes)} | ${fmt(l.mpesaFeesKes)} | ${fmt(l.netKes)} |`
    ),
    '',
    `**Gross collected:** KES ${fmt(grossKes)}`,
    `**Expenses:** KES ${fmt(expensesKes)}`,
    `**Management fee (${(params.managementFeePct * 100).toFixed(1)}%):** KES ${fmt(managementFeeKes)}`,
    `**M-Pesa fees:** KES ${fmt(mpesaFeesKes)}`,
    `**KRA MRI withheld:** KES ${fmt(params.mriWithheldKes)}`,
    `**Net to disburse:** KES ${fmt(netDisbursementKes)}`,
    arrearsKes > 0 ? `\n> Outstanding tenant arrears: KES ${fmt(arrearsKes)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    ownerId: params.ownerId,
    ownerName: params.ownerName,
    period: params.period,
    lines,
    total: {
      grossKes,
      expensesKes,
      managementFeeKes,
      mpesaFeesKes,
      mriWithheldKes: params.mriWithheldKes,
      netDisbursementKes,
    },
    arrearsKes,
    rendered,
  };
}

export const draftOwnerStatementTool: ToolHandler = {
  name: 'skill.finance.draft_owner_statement',
  description:
    'Draft a monthly owner statement from per-property collections, expenses, management fee, M-Pesa fees, and MRI withheld. Returns structured lines + markdown render.',
  parameters: {
    type: 'object',
    required: ['ownerId', 'ownerName', 'period', 'properties'],
    properties: {
      ownerId: { type: 'string' },
      ownerName: { type: 'string' },
      period: { type: 'string' },
      properties: { type: 'array', items: { type: 'object' } },
      managementFeePct: { type: 'number', default: 0.08 },
      mriWithheldKes: { type: 'number', default: 0 },
    },
  },
  async execute(params) {
    const parsed = OwnerStatementParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = draftOwnerStatement(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Owner statement ${result.ownerName} ${result.period}: net KES ${result.total.netDisbursementKes.toFixed(0)}`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.finance.draft_arrears_notice
// ---------------------------------------------------------------------------

export const ArrearsNoticeParamsSchema = z.object({
  tenants: z.array(
    z.object({
      tenantId: z.string().min(1),
      tenantName: z.string().min(1),
      unitLabel: z.string().min(1),
      amountKes: z.number().positive(),
      daysOverdue: z.number().int().nonnegative(),
      locale: z.enum(['en', 'sw', 'sheng']).default('sw'),
    })
  ),
  propertyName: z.string().default('Borjie'),
  /** Days thresholds for gentle -> firm -> legal. */
  thresholds: z
    .object({
      gentleMaxDays: z.number().int().default(14),
      firmMaxDays: z.number().int().default(45),
    })
    .default({ gentleMaxDays: 14, firmMaxDays: 45 }),
});

export interface ArrearsNoticeDraft {
  tenantId: string;
  tenantName: string;
  unitLabel: string;
  stratum: 'gentle' | 'firm' | 'legal_warn';
  subject: string;
  body: string;
  /** Risk level — firm+ requires review. */
  riskLevel: 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface ArrearsNoticeBatch {
  drafts: ArrearsNoticeDraft[];
  summary: {
    gentle: number;
    firm: number;
    legalWarn: number;
    totalKes: number;
  };
}

export function draftArrearsNotices(
  params: z.infer<typeof ArrearsNoticeParamsSchema>
): ArrearsNoticeBatch {
  const drafts: ArrearsNoticeDraft[] = [];
  const summary = { gentle: 0, firm: 0, legalWarn: 0, totalKes: 0 };

  for (const t of params.tenants) {
    let stratum: ArrearsNoticeDraft['stratum'] = 'gentle';
    let kind: 'rent_reminder_gentle' | 'rent_reminder_firm' = 'rent_reminder_gentle';
    let riskLevel: ArrearsNoticeDraft['riskLevel'] = 'MEDIUM';

    if (t.daysOverdue <= params.thresholds.gentleMaxDays) {
      stratum = 'gentle';
      kind = 'rent_reminder_gentle';
      riskLevel = 'MEDIUM';
      summary.gentle++;
    } else if (t.daysOverdue <= params.thresholds.firmMaxDays) {
      stratum = 'firm';
      kind = 'rent_reminder_firm';
      riskLevel = 'HIGH';
      summary.firm++;
    } else {
      stratum = 'legal_warn';
      kind = 'rent_reminder_firm';
      riskLevel = 'CRITICAL';
      summary.legalWarn++;
    }

    const notice = draftNotice({
      kind,
      locale: t.locale,
      tenantName: t.tenantName,
      unitLabel: t.unitLabel,
      amountKes: t.amountKes,
      date: `${t.daysOverdue} days ago`,
      propertyName: params.propertyName,
    });

    const legalSuffix =
      stratum === 'legal_warn'
        ? (t.locale === 'sw'
            ? '\n\nTahadhari: ikiwa malipo hayatafanyika ndani ya siku 7, hatua za kisheria zitachukuliwa.'
            : t.locale === 'sheng'
              ? '\n\nWarning: kama malipo haija-come ndani ya 7 days, tutaproceed na legal action.'
              : '\n\nNotice: if payment is not received within 7 days, legal proceedings will be initiated.')
        : '';

    drafts.push({
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      unitLabel: t.unitLabel,
      stratum,
      subject: notice.subject,
      body: notice.body + legalSuffix,
      riskLevel,
    });

    summary.totalKes += t.amountKes;
  }

  return { drafts, summary };
}

export const draftArrearsNoticeTool: ToolHandler = {
  name: 'skill.finance.draft_arrears_notice',
  description:
    'Stratify a tenant arrears list into gentle/firm/legal-warn strata and draft notices per stratum in the tenant locale. Returns batch + risk levels.',
  parameters: {
    type: 'object',
    required: ['tenants'],
    properties: {
      tenants: { type: 'array', items: { type: 'object' } },
      propertyName: { type: 'string' },
      thresholds: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = ArrearsNoticeParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = draftArrearsNotices(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Arrears notices: ${result.summary.gentle} gentle, ${result.summary.firm} firm, ${result.summary.legalWarn} legal-warn. Total KES ${result.summary.totalKes.toFixed(0)}.`,
    };
  },
};

export const FINANCE_SKILL_TOOLS: ToolHandler[] = [
  draftOwnerStatementTool,
  draftArrearsNoticeTool,
];
