import { describe, expect, it } from 'vitest';
import { createKraFilingAssistantSubMd, KRA_FILING_ASSISTANT_NAME } from '../index.js';
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
        summary: 'Backfill tenant PINs before day 5',
        steps: [
          { id: 'pin-backfill', description: 'Compile + PIN audit by day 5', expectedImpact: '+10% on-time' },
        ],
        predicted: { metric: 'on-time-by-day15-rate', value: 0.92, unit: 'fraction' },
      }),
    };
  },
};

function makeCtx(): SubMdContext {
  return {
    scope: { tenantId: TENANT },
    nowMs: 0,
    correlationId: 'c-kra',
    budget: DEFAULT_SUB_MD_BUDGET,
    llm,
  };
}

describe('kra.filing_assistant — full pipeline', () => {
  it('OBSERVE → MAP → REDESIGN → AUTOMATE', async () => {
    const sub = createKraFilingAssistantSubMd({ scope: { tenantId: TENANT } });
    const events: ObservedEvent[] = [
      { id: '1', topic: 'kra.filing.cycle', tenantId: TENANT, occurredAtMs: 1, payload: { filingId: 'f1', state: 'compiled' } },
      { id: '2', topic: 'kra.filing.cycle', tenantId: TENANT, occurredAtMs: 2, payload: { filingId: 'f1', state: 'validated' } },
      { id: '3', topic: 'kra.filing.cycle', tenantId: TENANT, occurredAtMs: 3, payload: { filingId: 'f1', state: 'drafted' } },
      { id: '4', topic: 'kra.filing.cycle', tenantId: TENANT, occurredAtMs: 4, payload: { filingId: 'f1', state: 'submitted' } },
      { id: '5', topic: 'kra.filing.cycle', tenantId: TENANT, occurredAtMs: 5, payload: { filingId: 'f1', state: 'accepted' } },
    ];
    const ctx = makeCtx();
    const graph = await sub.map(events, ctx);
    expect(graph.observationCount).toBe(5);
    const proposal = await sub.redesign(graph, ctx);
    expect(proposal.steps.length).toBeGreaterThanOrEqual(1);
    const artifact = await sub.automate(proposal, ctx);
    expect(artifact.skillName.startsWith('kra-filing-assistant.')).toBe(true);
  });

  it('exposes 4 tools', () => {
    const sub = createKraFilingAssistantSubMd({ scope: { tenantId: TENANT } });
    expect(sub.toolBelt.length).toBe(4);
    expect(sub.toolBelt).toContain('kra.draft_filing');
  });

  it('riskTier is read — Tier-C draft-only', () => {
    const sub = createKraFilingAssistantSubMd({ scope: { tenantId: TENANT } });
    expect(sub.riskTier).toBe('read');
  });

  it('name matches', () => {
    const sub = createKraFilingAssistantSubMd({ scope: { tenantId: TENANT } });
    expect(sub.name).toBe(KRA_FILING_ASSISTANT_NAME);
  });
});
