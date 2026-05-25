import { describe, it, expect } from 'vitest';
import {
  planTenantLetter,
  planVisualAnnouncement,
  COMMS_SKILL_TOOLS,
} from '../comms.js';

describe('comms — draft_tenant_letter', () => {
  it('plans a residency-proof letter with a text render job', () => {
    const plan = planTenantLetter({
      letterType: 'residency_proof',
      tenantName: 'Jane',
      propertyAddress: '1 Moi Ave',
      unitIdentifier: 'A-2',
      landlordName: 'Acme',
      context: { residentSince: '2023-01-01', currency: 'KES' },
    });
    expect(plan.templateId).toBe('residency-proof-v1');
    expect(plan.renderJobRequest.rendererKind).toBe('text');
    expect(plan.needsApproval).toBe(true);
  });

  it('plans tenant-reference letter with conduct fields', () => {
    const plan = planTenantLetter({
      letterType: 'tenant_reference',
      tenantName: 'Jane',
      propertyAddress: 'P',
      unitIdentifier: 'U',
      landlordName: 'L',
      context: {
        currency: 'KES',
        paymentRecord: 'excellent',
        propertyCondition: 'good',
        recommend: true,
      },
    });
    expect(plan.templateId).toBe('tenant-reference-v1');
    expect((plan.renderJobRequest.inputs as Record<string, unknown>).recommend).toBe(true);
  });
});

describe('comms — draft_visual_announcement', () => {
  it('returns document render job only when no cover imagery requested', () => {
    const plan = planVisualAnnouncement({
      title: 'Water shutdown',
      body: 'Water will be off Saturday.',
      audience: 'tenants',
      locale: 'sw',
      coverImagery: { enabled: false },
    });
    expect(plan.documentRenderJobRequest.context).toBe('document');
    expect(plan.imageryRenderJobRequest).toBeUndefined();
  });

  it('also returns imagery job when coverImagery.enabled is true', () => {
    const plan = planVisualAnnouncement({
      title: 'Open house',
      body: 'Join us this weekend.',
      audience: 'public',
      locale: 'en',
      coverImagery: { enabled: true, style: 'poster' },
    });
    expect(plan.imageryRenderJobRequest?.context).toBe('marketing-imagery');
    expect(plan.imageryRenderJobRequest?.rendererKind).toBe('nano-banana');
    expect(plan.imageryRenderJobRequest?.note).toMatch(/MARKETING IMAGERY ONLY/);
  });
});

describe('COMMS_SKILL_TOOLS registers the new skills', () => {
  it('exposes draft_tenant_letter and draft_visual_announcement', () => {
    const names = COMMS_SKILL_TOOLS.map((t) => t.name);
    expect(names).toContain('skill.comms.draft_tenant_letter');
    expect(names).toContain('skill.comms.draft_visual_announcement');
    // preserves existing ones
    expect(names).toContain('skill.comms.draft_tenant_notice');
    expect(names).toContain('skill.comms.draft_campaign');
  });
});
