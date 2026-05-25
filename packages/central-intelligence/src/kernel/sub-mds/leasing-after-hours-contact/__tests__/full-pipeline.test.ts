import { describe, expect, it } from 'vitest';
import {
  createLeasingAfterHoursSubMd,
  LEASING_AFTER_HOURS_NAME,
} from '../index.js';
import {
  DEFAULT_SUB_MD_BUDGET,
  type ObservedEvent,
  type SubMdContext,
  type SubMdLlmPort,
} from '../../shared/sub-md-base.js';

const TENANT = 't1';

const llm: SubMdLlmPort = {
  async generate() {
    return {
      text: JSON.stringify({
        summary: 'Tighten reply template + surface owner-review faster',
        steps: [
          { id: 'tighten-template', description: 'Shorter price-band language', expectedImpact: '+15% draft-acceptance' },
        ],
        predicted: { metric: 'draft-acceptance-rate', value: 0.78, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-leasing',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

function makeEvents(): ObservedEvent[] {
  return [
    { id: '1', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 1, payload: { inquiryId: 'iq-1', state: 'received' } },
    { id: '2', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 2, payload: { inquiryId: 'iq-1', state: 'classified' } },
    { id: '3', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 3, payload: { inquiryId: 'iq-1', state: 'drafted' } },
    { id: '4', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 4, payload: { inquiryId: 'iq-1', state: 'owner-approved' } },
    { id: '5', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 5, payload: { inquiryId: 'iq-1', state: 'sent' } },
    { id: '6', topic: 'leasing.inquiry', tenantId: TENANT, occurredAtMs: 6, payload: { inquiryId: 'iq-2', state: 'received', sla_breached: true } },
  ];
}

describe('leasing.after_hours_contact — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE produces a draft artefact', async () => {
    const sub = createLeasingAfterHoursSubMd({ scope: { tenantId: TENANT } });
    const events = makeEvents();
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(events.length);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('leasing-after-hours-contact.')).toBe(true);
    expect(artifact.draftStatus).toBe('review-requested');
    expect(artifact.hookNames).toContain('leasing.classify_inquiry');
  });

  it('exposes 4 tools in the toolbelt', () => {
    const sub = createLeasingAfterHoursSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('leasing.draft_response');
    expect(sub.toolBelt).toContain('leasing.schedule_viewing_draft');
  });

  it('riskTier is read — Tier-B sub-MD never writes; produces drafts only', () => {
    const sub = createLeasingAfterHoursSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('read');
  });

  it('observe() yields zero events when no event port', async () => {
    const sub = createLeasingAfterHoursSubMd({ scope: { tenantId: TENANT } });
    const collected: ObservedEvent[] = [];
    for await (const e of sub.observe(makeCtx())) collected.push(e);
    expect(collected.length).toBe(0);
  });

  it('persona has the LEASING_AFTER_HOURS_NAME', () => {
    const sub = createLeasingAfterHoursSubMd({ scope: { tenantId: TENANT } });
    expect(sub.name).toBe(LEASING_AFTER_HOURS_NAME);
    expect(sub.persona.id).toBe('after-hours-leasing-agent');
  });
});
