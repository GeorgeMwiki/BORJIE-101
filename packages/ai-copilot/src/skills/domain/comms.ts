/**
 * Communications domain skills:
 *  - skill.comms.draft_tenant_notice — wrapper that extends swahili_draft
 *    with multi-channel targeting (whatsapp/sms/email) + delivery preview
 *  - skill.comms.draft_campaign      — vacancy / lead-nurture campaign plan
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { draftNotice, NoticeKindSchema, LocaleSchema } from '../kenya/swahili-draft.js';

// ---------------------------------------------------------------------------
// skill.comms.draft_tenant_notice
// ---------------------------------------------------------------------------

export const ChannelSchema = z.enum(['whatsapp', 'sms', 'email']);
export type Channel = z.infer<typeof ChannelSchema>;

export const TenantNoticeParamsSchema = z.object({
  kind: NoticeKindSchema,
  locale: LocaleSchema.default('sw'),
  recipients: z.array(
    z.object({
      tenantId: z.string().min(1),
      tenantName: z.string().min(1),
      unitLabel: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      preferredChannel: ChannelSchema.optional(),
    })
  ),
  defaults: z.object({
    amountKes: z.number().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    reason: z.string().optional(),
    propertyName: z.string().optional(),
  }).default({}),
  defaultChannel: ChannelSchema.default('whatsapp'),
});

export interface TenantNoticeDraft {
  tenantId: string;
  tenantName: string;
  channel: Channel;
  subject: string;
  body: string;
  /** For SMS, body is auto-truncated to 160 chars and flagged. */
  truncated?: boolean;
}

export interface TenantNoticeBatch {
  kind: string;
  locale: string;
  drafts: TenantNoticeDraft[];
  byChannel: Record<Channel, number>;
  recipientsWithoutContact: string[];
}

export function draftTenantNotices(
  params: z.infer<typeof TenantNoticeParamsSchema>
): TenantNoticeBatch {
  const byChannel: Record<Channel, number> = { whatsapp: 0, sms: 0, email: 0 };
  const recipientsWithoutContact: string[] = [];
  const drafts: TenantNoticeDraft[] = [];

  for (const r of params.recipients) {
    const channel =
      r.preferredChannel ??
      (r.phone ? params.defaultChannel : r.email ? 'email' : params.defaultChannel);

    if (
      (channel === 'email' && !r.email) ||
      ((channel === 'whatsapp' || channel === 'sms') && !r.phone)
    ) {
      recipientsWithoutContact.push(r.tenantId);
      continue;
    }

    const notice = draftNotice({
      kind: params.kind,
      locale: params.locale,
      tenantName: r.tenantName,
      unitLabel: r.unitLabel,
      amountKes: params.defaults.amountKes,
      date: params.defaults.date,
      time: params.defaults.time,
      reason: params.defaults.reason,
      propertyName: params.defaults.propertyName,
    });

    let body = notice.body;
    let truncated = false;
    if (channel === 'sms' && body.length > 160) {
      body = body.slice(0, 157) + '...';
      truncated = true;
    }

    byChannel[channel]++;
    drafts.push({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      channel,
      subject: notice.subject,
      body,
      truncated: truncated || undefined,
    });
  }

  return {
    kind: params.kind,
    locale: params.locale,
    drafts,
    byChannel,
    recipientsWithoutContact,
  };
}

export const draftTenantNoticeTool: ToolHandler = {
  name: 'skill.comms.draft_tenant_notice',
  description:
    'Draft a tenant notice batch across multiple recipients in Swahili/English/Sheng, routed to WhatsApp/SMS/Email. SMS auto-truncates to 160 chars. Flags recipients with no contact channel.',
  parameters: {
    type: 'object',
    required: ['kind', 'recipients'],
    properties: {
      kind: { type: 'string' },
      locale: { type: 'string' },
      recipients: { type: 'array', items: { type: 'object' } },
      defaults: { type: 'object' },
      defaultChannel: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = TenantNoticeParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = draftTenantNotices(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Drafted ${result.drafts.length} notices (${result.kind}, ${result.locale}); ${result.recipientsWithoutContact.length} skipped (no contact).`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.comms.draft_campaign
// ---------------------------------------------------------------------------

export const CampaignParamsSchema = z.object({
  goal: z.enum(['vacancy_fill', 'lead_nurture', 'owner_acquisition', 'renewal_push']),
  targetAudienceSize: z.number().int().positive().default(100),
  channels: z.array(ChannelSchema).min(1).default(['whatsapp']),
  propertyName: z.string().default('Borjie'),
  startDate: z.string().optional(),
  budgetKes: z.number().nonnegative().default(0),
  locale: LocaleSchema.default('sw'),
});

export interface CampaignStep {
  step: number;
  daysFromStart: number;
  channel: Channel;
  intent: string;
  messageTemplate: string;
  expectedResponseRate: number;
}

export interface CampaignPlan {
  goal: string;
  steps: CampaignStep[];
  estimatedConversion: number;
  estimatedCostKes: number;
  kpis: string[];
}

const BASE_TEMPLATES: Record<
  'vacancy_fill' | 'lead_nurture' | 'owner_acquisition' | 'renewal_push',
  CampaignStep[]
> = {
  vacancy_fill: [
    { step: 1, daysFromStart: 0, channel: 'whatsapp', intent: 'introduce', messageTemplate: 'Announce vacancy + unique value prop', expectedResponseRate: 0.12 },
    { step: 2, daysFromStart: 3, channel: 'whatsapp', intent: 'incentive', messageTemplate: 'Share viewing incentive (early-bird discount)', expectedResponseRate: 0.18 },
    { step: 3, daysFromStart: 7, channel: 'sms', intent: 'scarcity', messageTemplate: 'Reinforce scarcity (X units left)', expectedResponseRate: 0.08 },
    { step: 4, daysFromStart: 14, channel: 'whatsapp', intent: 'social_proof', messageTemplate: 'Share resident testimonial', expectedResponseRate: 0.1 },
  ],
  lead_nurture: [
    { step: 1, daysFromStart: 0, channel: 'whatsapp', intent: 'welcome', messageTemplate: 'Welcome + set expectations', expectedResponseRate: 0.4 },
    { step: 2, daysFromStart: 2, channel: 'whatsapp', intent: 'qualify', messageTemplate: 'Ask 3 qualifying questions', expectedResponseRate: 0.3 },
    { step: 3, daysFromStart: 5, channel: 'email', intent: 'content', messageTemplate: 'Neighborhood guide', expectedResponseRate: 0.12 },
    { step: 4, daysFromStart: 9, channel: 'whatsapp', intent: 'cta', messageTemplate: 'Schedule viewing', expectedResponseRate: 0.15 },
  ],
  owner_acquisition: [
    { step: 1, daysFromStart: 0, channel: 'email', intent: 'introduce', messageTemplate: 'Borjie value prop for owners', expectedResponseRate: 0.06 },
    { step: 2, daysFromStart: 5, channel: 'whatsapp', intent: 'proof', messageTemplate: 'Case study + ROI numbers', expectedResponseRate: 0.08 },
    { step: 3, daysFromStart: 14, channel: 'whatsapp', intent: 'cta', messageTemplate: 'Book a 15-min consult', expectedResponseRate: 0.05 },
  ],
  renewal_push: [
    { step: 1, daysFromStart: 0, channel: 'whatsapp', intent: 'invite', messageTemplate: 'Lease renewal invitation', expectedResponseRate: 0.35 },
    { step: 2, daysFromStart: 7, channel: 'whatsapp', intent: 'terms', messageTemplate: 'Share renewal terms + incentive', expectedResponseRate: 0.25 },
    { step: 3, daysFromStart: 14, channel: 'email', intent: 'formal', messageTemplate: 'Formal renewal offer', expectedResponseRate: 0.4 },
  ],
};

export function buildCampaign(
  params: z.infer<typeof CampaignParamsSchema>
): CampaignPlan {
  const baseSteps = BASE_TEMPLATES[params.goal];
  // Filter to channels the campaign supports.
  const steps = baseSteps
    .filter((s) => params.channels.includes(s.channel))
    .map((s, i) => ({ ...s, step: i + 1 }));

  const conversion = steps.reduce(
    (acc, s) => acc + (1 - acc) * s.expectedResponseRate * 0.3,
    0
  );

  // Estimate channel cost per message (KES) — conservative.
  const costPerMsg: Record<Channel, number> = { whatsapp: 2, sms: 1.5, email: 0.3 };
  const costPerStep = steps.reduce(
    (s, step) => s + costPerMsg[step.channel] * params.targetAudienceSize,
    0
  );
  const estimatedCostKes = costPerStep;

  return {
    goal: params.goal,
    steps,
    estimatedConversion: conversion,
    estimatedCostKes,
    kpis: [
      'response_rate_per_step',
      'click_through_rate',
      'viewings_booked',
      'conversions',
      'cost_per_conversion_kes',
    ],
  };
}

export const draftCampaignTool: ToolHandler = {
  name: 'skill.comms.draft_campaign',
  description:
    'Build a multi-step communications campaign plan for vacancy fill / lead nurture / owner acquisition / renewal push. Returns step sequence, conversion estimate, cost, KPIs.',
  parameters: {
    type: 'object',
    required: ['goal'],
    properties: {
      goal: {
        type: 'string',
        enum: ['vacancy_fill', 'lead_nurture', 'owner_acquisition', 'renewal_push'],
      },
      targetAudienceSize: { type: 'number' },
      channels: { type: 'array', items: { type: 'string' } },
      propertyName: { type: 'string' },
      startDate: { type: 'string' },
      budgetKes: { type: 'number' },
      locale: { type: 'string' },
    },
  },
  async execute(params) {
    const parsed = CampaignParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = buildCampaign(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `${result.goal} campaign: ${result.steps.length} steps; est ${(result.estimatedConversion * 100).toFixed(1)}% conversion; ~KES ${result.estimatedCostKes.toFixed(0)} cost.`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.comms.draft_tenant_letter  (NEW 10 — on-demand letters)
// ---------------------------------------------------------------------------

export const LetterTypeSchema = z.enum([
  'residency_proof',
  'tenancy_confirmation',
  'payment_confirmation',
  'tenant_reference',
]);
export type LetterType = z.infer<typeof LetterTypeSchema>;

export const DraftTenantLetterParamsSchema = z.object({
  letterType: LetterTypeSchema,
  tenantName: z.string().min(1),
  tenantIdNumber: z.string().optional(),
  propertyAddress: z.string().min(1),
  unitIdentifier: z.string().min(1),
  landlordName: z.string().min(1),
  organizationName: z.string().optional(),
  context: z
    .object({
      leaseStartDate: z.string().optional(),
      leaseEndDate: z.string().optional(),
      monthlyRent: z.number().optional(),
      // Currency must be passed by the caller (resolved from tenant
      // region-config). Optional here because many letters don't
      // include money; when they do, callers supply it explicitly.
      currency: z.string().optional(),
      residentSince: z.string().optional(),
      purposeNote: z.string().optional(),
      requestedBy: z.string().optional(),
      payments: z
        .array(
          z.object({
            paidOn: z.string(),
            description: z.string(),
            amount: z.number(),
            method: z.string(),
            reference: z.string().optional(),
          })
        )
        .optional(),
      paymentRecord: z.enum(['excellent', 'good', 'satisfactory', 'poor']).optional(),
      propertyCondition: z.enum(['excellent', 'good', 'satisfactory', 'poor']).optional(),
      recommend: z.boolean().optional(),
      conductNotes: z.string().optional(),
    })
    .default({}),
});

export interface TenantLetterDraft {
  readonly letterType: LetterType;
  readonly templateId: string;
  readonly subject: string;
  readonly preview: string;
  readonly renderJobRequest: {
    readonly rendererKind: 'text' | 'docxtemplater' | 'react-pdf' | 'typst';
    readonly templateId: string;
    readonly inputs: Record<string, unknown>;
  };
  readonly needsApproval: true;
}

/** Pure planner — does NOT render the final artifact; returns a render-job
 *  request that LetterService + RendererFactory will fulfill. */
export function planTenantLetter(
  params: z.infer<typeof DraftTenantLetterParamsSchema>
): TenantLetterDraft {
  const now = new Date().toISOString().slice(0, 10);
  const ref = `LTR-${Date.now().toString(36).toUpperCase()}`;
  const base = {
    letterReference: ref,
    issueDate: now,
    tenantName: params.tenantName,
    tenantIdNumber: params.tenantIdNumber,
    propertyAddress: params.propertyAddress,
    unitIdentifier: params.unitIdentifier,
    landlordName: params.landlordName,
    organizationName: params.organizationName,
  };

  let templateId: string;
  let subject: string;
  let preview: string;
  let inputs: Record<string, unknown>;

  switch (params.letterType) {
    case 'residency_proof':
      templateId = 'residency-proof-v1';
      subject = `Residency proof for ${params.tenantName}`;
      preview = `Confirms ${params.tenantName} resides at ${params.propertyAddress} (Unit ${params.unitIdentifier}).`;
      inputs = {
        ...base,
        residentSince: params.context.residentSince ?? params.context.leaseStartDate ?? now,
        purposeNote: params.context.purposeNote,
      };
      break;
    case 'tenancy_confirmation':
      templateId = 'tenancy-confirmation-v1';
      subject = `Tenancy confirmation for ${params.tenantName}`;
      preview = `Confirms active tenancy, rent ${params.context.currency} ${params.context.monthlyRent ?? '?'}.`;
      inputs = {
        ...base,
        leaseStartDate: params.context.leaseStartDate ?? now,
        leaseEndDate: params.context.leaseEndDate,
        monthlyRent: params.context.monthlyRent ?? 0,
        currency: params.context.currency,
        requestedBy: params.context.requestedBy,
      };
      break;
    case 'payment_confirmation':
      templateId = 'payment-confirmation-v1';
      subject = `Payment confirmation for ${params.tenantName}`;
      preview = `Confirms ${params.context.payments?.length ?? 0} payment(s) received.`;
      inputs = {
        ...base,
        payments: params.context.payments ?? [],
        currency: params.context.currency,
        note: params.context.purposeNote,
      };
      break;
    case 'tenant_reference':
      templateId = 'tenant-reference-v1';
      subject = `Tenant reference for ${params.tenantName}`;
      preview = `Reference letter. Payment: ${params.context.paymentRecord ?? 'n/a'}; Property: ${params.context.propertyCondition ?? 'n/a'}.`;
      inputs = {
        ...base,
        tenancyStart: params.context.leaseStartDate ?? now,
        tenancyEnd: params.context.leaseEndDate,
        paymentRecord: params.context.paymentRecord ?? 'good',
        propertyCondition: params.context.propertyCondition ?? 'good',
        conductNotes: params.context.conductNotes,
        recommend: params.context.recommend ?? true,
      };
      break;
  }

  return {
    letterType: params.letterType,
    templateId,
    subject,
    preview,
    renderJobRequest: {
      rendererKind: 'text',
      templateId,
      inputs,
    },
    needsApproval: true,
  };
}

export const draftTenantLetterTool: ToolHandler = {
  name: 'skill.comms.draft_tenant_letter',
  description:
    'Plan an on-demand tenant letter (residency proof, tenancy confirmation, payment confirmation, tenant reference). Returns a render-job request; actual rendering & approval handled by LetterService.',
  parameters: {
    type: 'object',
    required: [
      'letterType',
      'tenantName',
      'propertyAddress',
      'unitIdentifier',
      'landlordName',
    ],
    properties: {
      letterType: { type: 'string' },
      tenantName: { type: 'string' },
      tenantIdNumber: { type: 'string' },
      propertyAddress: { type: 'string' },
      unitIdentifier: { type: 'string' },
      landlordName: { type: 'string' },
      organizationName: { type: 'string' },
      context: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = DraftTenantLetterParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const plan = planTenantLetter(parsed.data);
    return {
      ok: true,
      data: plan,
      evidenceSummary: `Planned ${plan.letterType} letter (${plan.templateId}); requires approval before issuance.`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.comms.draft_visual_announcement
// ---------------------------------------------------------------------------
// Text-document announcements rendered via the document renderer;
// OPTIONALLY pair with a Nano Banana marketing cover image. The cover
// image is MARKETING IMAGERY ONLY and never replaces the text document.
//
// This skill returns BOTH a document render-job request (mandatory) and
// an optional imagery render-job request — strictly separated, per the
// renderer-factory guardrails.

export const VisualAnnouncementParamsSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience: z.enum(['tenants', 'owners', 'staff', 'public']).default('tenants'),
  locale: LocaleSchema.default('sw'),
  coverImagery: z
    .object({
      enabled: z.boolean().default(false),
      prompt: z.string().optional(),
      style: z.enum(['photo', 'illustration', 'poster', 'flyer']).default('poster'),
      brandPalette: z.array(z.string()).optional(),
    })
    .default({ enabled: false }),
});

export interface VisualAnnouncementPlan {
  readonly title: string;
  readonly audience: string;
  readonly locale: string;
  readonly documentRenderJobRequest: {
    readonly context: 'document';
    readonly rendererKind: 'text' | 'docxtemplater' | 'react-pdf' | 'typst';
    readonly templateId: string;
    readonly inputs: Record<string, unknown>;
  };
  readonly imageryRenderJobRequest?: {
    readonly context: 'marketing-imagery';
    readonly rendererKind: 'nano-banana';
    readonly inputs: {
      readonly prompt: string;
      readonly style: 'photo' | 'illustration' | 'poster' | 'flyer';
      readonly brandPalette?: readonly string[];
    };
    readonly note: 'MARKETING IMAGERY ONLY — supplemental to the document';
  };
}

export function planVisualAnnouncement(
  params: z.infer<typeof VisualAnnouncementParamsSchema>
): VisualAnnouncementPlan {
  const plan: VisualAnnouncementPlan = {
    title: params.title,
    audience: params.audience,
    locale: params.locale,
    documentRenderJobRequest: {
      context: 'document',
      rendererKind: 'text',
      templateId: 'announcement-v1',
      inputs: {
        title: params.title,
        body: params.body,
        audience: params.audience,
        locale: params.locale,
        issuedAt: new Date().toISOString(),
      },
    },
  };

  if (params.coverImagery.enabled) {
    const prompt =
      params.coverImagery.prompt ??
      `${params.title} — ${params.audience} audience, Kenyan property-management brand tone`;
    return {
      ...plan,
      imageryRenderJobRequest: {
        context: 'marketing-imagery',
        rendererKind: 'nano-banana',
        inputs: {
          prompt,
          style: params.coverImagery.style,
          brandPalette: params.coverImagery.brandPalette,
        },
        note: 'MARKETING IMAGERY ONLY — supplemental to the document',
      },
    };
  }
  return plan;
}

export const draftVisualAnnouncementTool: ToolHandler = {
  name: 'skill.comms.draft_visual_announcement',
  description:
    'Plan a text-document announcement (rendered via the document renderer) with an OPTIONAL Nano Banana marketing cover image. Imagery is strictly supplemental; never replaces the document.',
  parameters: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      audience: { type: 'string' },
      locale: { type: 'string' },
      coverImagery: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = VisualAnnouncementParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const plan = planVisualAnnouncement(parsed.data);
    return {
      ok: true,
      data: plan,
      evidenceSummary: `Planned announcement '${plan.title}' (${plan.audience}, ${plan.locale})${
        plan.imageryRenderJobRequest ? ' + marketing cover imagery' : ''
      }.`,
    };
  },
};

export const COMMS_SKILL_TOOLS: ToolHandler[] = [
  draftTenantNoticeTool,
  draftCampaignTool,
  draftTenantLetterTool,
  draftVisualAnnouncementTool,
];
