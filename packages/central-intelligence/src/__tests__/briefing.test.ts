/**
 * Briefing composer — unit tests.
 *
 * Covers:
 *   - throws on empty data points
 *   - severity → stakes mapping (urgent→high, warn→medium, info→low)
 *   - tenant scope → tier=org; platform scope → tier=industry
 *   - bullets carry severity badges (urgent/attention/fyi)
 *   - headline uses topPriority.summary when supplied; else first sentence
 *   - userMessage in ThoughtRequest renders all data points
 *   - decision.kind === 'refusal' → headline derives from refusal text
 */

import { describe, it, expect } from 'vitest';
import {
  createBriefingComposer,
  type BrainKernel,
  type BrainDecision,
  type ThoughtRequest,
  type BriefingDataPoint,
  type BriefingInputs,
  type UserProfile,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const USER: UserProfile = {
  userId: 'u_alice',
  displayName: 'Alice Operator',
  role: 'estate manager',
  affiliation: 'Acme Estates',
};

const TENANT: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

const PLATFORM: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'platform-sovereign',
};

function answer(text: string): BrainDecision {
  return {
    kind: 'answer',
    text,
    citations: [],
    artifacts: [],
    confidence: { groundedness: 1, stability: 1, review: 1, numericalConsistency: 1, overall: 1 },
  } as unknown as BrainDecision;
}

function refusal(reason: string): BrainDecision {
  return {
    kind: 'refusal',
    reason,
    gateThatRefused: 'inviolable',
  } as unknown as BrainDecision;
}

function makeKernel(decision: BrainDecision = answer('Quiet morning. Two things to look at.')): { kernel: BrainKernel; lastReq: { value: ThoughtRequest | null } } {
  const lastReq: { value: ThoughtRequest | null } = { value: null };
  const kernel = {
    async think(req: ThoughtRequest): Promise<BrainDecision> {
      lastReq.value = req;
      return decision;
    },
  } as unknown as BrainKernel;
  return { kernel, lastReq };
}

const dp = (over: Partial<BriefingDataPoint> = {}): BriefingDataPoint => ({
  topic: 'collection',
  summary: 'collection at 92%',
  severity: 'info',
  ...over,
});

const inputs = (over: Partial<BriefingInputs> = {}): BriefingInputs => ({
  day: '2026-05-08',
  user: USER,
  scope: TENANT,
  threadId: 'th',
  dataPoints: [dp()],
  topPriority: null,
  ...over,
});

describe('createBriefingComposer', () => {
  it('throws when no data points are provided', async () => {
    const { kernel } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await expect(composer.compose(inputs({ dataPoints: [] }))).rejects.toThrow(
      /at least one data point/,
    );
  });

  it('uses topPriority.summary as the headline when supplied', async () => {
    const { kernel } = makeKernel(answer('We collected on time. Nothing else to flag.'));
    const composer = createBriefingComposer({ kernel });
    const out = await composer.compose(inputs({
      topPriority: dp({ summary: 'lease 42 in arrears day 3' }),
    }));
    expect(out.headline).toBe('lease 42 in arrears day 3');
  });

  it('uses first sentence of decision text when topPriority is null', async () => {
    const { kernel } = makeKernel(answer('Quiet morning. Nothing pressing.'));
    const composer = createBriefingComposer({ kernel });
    const out = await composer.compose(inputs({ topPriority: null }));
    expect(out.headline).toBe('Quiet morning.');
  });

  it('maps urgent → stakes=high', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({ dataPoints: [dp({ severity: 'urgent' })] }));
    expect(lastReq.value?.stakes).toBe('high');
  });

  it('maps warn → stakes=medium', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({ dataPoints: [dp({ severity: 'warn' })] }));
    expect(lastReq.value?.stakes).toBe('medium');
  });

  it('maps info-only → stakes=low', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({ dataPoints: [dp({ severity: 'info' })] }));
    expect(lastReq.value?.stakes).toBe('low');
  });

  it('routes platform scope to tier=industry', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({ scope: PLATFORM }));
    expect(lastReq.value?.tier).toBe('industry');
  });

  it('routes tenant scope to tier=org', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({ scope: TENANT }));
    expect(lastReq.value?.tier).toBe('org');
  });

  it('renders bullets with severity badges', async () => {
    const { kernel } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    const out = await composer.compose(inputs({
      dataPoints: [
        dp({ severity: 'urgent', summary: 'arrears spike' }),
        dp({ severity: 'warn', summary: 'work-order backlog' }),
        dp({ severity: 'info', summary: 'occupancy holding' }),
      ],
    }));
    expect(out.bullets[0]).toBe('urgent — arrears spike');
    expect(out.bullets[1]).toBe('attention — work-order backlog');
    expect(out.bullets[2]).toBe('fyi — occupancy holding');
  });

  it('renders all data points into the userMessage prompt', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({
      dataPoints: [
        dp({ topic: 'collection', summary: 'collection 92%' }),
        dp({ topic: 'arrears', summary: '3 active arrears cases', severity: 'warn' }),
      ],
    }));
    const msg = lastReq.value?.userMessage ?? '';
    expect(msg).toMatch(/collection 92%/);
    expect(msg).toMatch(/3 active arrears cases/);
    expect(msg).toMatch(/\[INFO\]/);
    expect(msg).toMatch(/\[WARN\]/);
  });

  it('uses refusal.reason as headline source when decision is a refusal', async () => {
    const { kernel } = makeKernel(refusal('Blocked: cross-tenant probe.'));
    const composer = createBriefingComposer({ kernel });
    const out = await composer.compose(inputs({ topPriority: null }));
    expect(out.headline).toBe('Blocked: cross-tenant probe.');
  });

  it('threads the briefing day through to the output', async () => {
    const { kernel } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    const out = await composer.compose(inputs({ day: '2026-12-25' }));
    expect(out.day).toBe('2026-12-25');
  });

  it('preserves citationLabel in the rendered prompt', async () => {
    const { kernel, lastReq } = makeKernel();
    const composer = createBriefingComposer({ kernel });
    await composer.compose(inputs({
      dataPoints: [dp({ citationLabel: 'tool:collection.kpi' })],
    }));
    expect(lastReq.value?.userMessage).toMatch(/\[cite:tool:collection\.kpi\]/);
  });
});
