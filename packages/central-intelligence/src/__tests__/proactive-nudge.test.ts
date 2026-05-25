/**
 * Proactive nudge router — unit tests.
 *
 * Covers:
 *   - dedupe within cooldown returns null
 *   - first-time intent renders through the kernel mock
 *   - severity → stakes mapping (info→low, warn→medium, urgent→high)
 *   - platform scope routes tier=industry; tenant scope routes tier=org
 *   - decision.kind === 'refusal' → nudge.text uses the refusal reason
 *   - dedupe entry survives across cooldown window for the same id
 *   - in-memory dedupe respects cooldownMs boundary
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createNudgeRouter,
  createInMemoryNudgeDedupe,
  type BrainKernel,
  type BrainDecision,
  type ThoughtRequest,
  type NudgeIntent,
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

function makeKernel(decision: BrainDecision = answer('Heads up.')): { kernel: BrainKernel; lastReq: { value: ThoughtRequest | null } } {
  const lastReq: { value: ThoughtRequest | null } = { value: null };
  const kernel = {
    async think(req: ThoughtRequest): Promise<BrainDecision> {
      lastReq.value = req;
      return decision;
    },
  } as unknown as BrainKernel;
  return { kernel, lastReq };
}

function intent(over: Partial<NudgeIntent> = {}): NudgeIntent {
  return {
    id: 'arrears:lease_42:advance',
    user: USER,
    scope: TENANT,
    threadId: 'thread-x',
    trigger: 'arrears ladder advanced to step 2',
    severity: 'warn',
    suggestedAction: 'send notice',
    proposedAt: '2026-05-08T10:00:00Z',
    ...over,
  };
}

describe('createNudgeRouter', () => {
  it('renders a first-time intent through the kernel', async () => {
    const { kernel, lastReq } = makeKernel(answer('Look at lease 42 today.'));
    const router = createNudgeRouter({
      kernel,
      dedupe: createInMemoryNudgeDedupe(),
    });
    const out = await router.route(intent());
    expect(out).not.toBeNull();
    expect(out?.text).toBe('Look at lease 42 today.');
    expect(out?.severity).toBe('warn');
    expect(out?.suggestedAction).toBe('send notice');
    expect(lastReq.value?.userMessage).toMatch(/Trigger: arrears ladder/);
  });

  it('returns null on dedup hit within cooldown', async () => {
    const { kernel } = makeKernel();
    const dedupe = createInMemoryNudgeDedupe();
    const router = createNudgeRouter({ kernel, dedupe, cooldownMs: 60_000 });
    await router.route(intent());
    const second = await router.route(intent());
    expect(second).toBeNull();
  });

  it('maps severity=info to stakes=low', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ id: 'a', severity: 'info' }));
    expect(lastReq.value?.stakes).toBe('low');
  });

  it('maps severity=warn to stakes=medium', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ id: 'a', severity: 'warn' }));
    expect(lastReq.value?.stakes).toBe('medium');
  });

  it('maps severity=urgent to stakes=high', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ id: 'a', severity: 'urgent' }));
    expect(lastReq.value?.stakes).toBe('high');
  });

  it('routes platform scope to tier=industry', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ id: 'pl', scope: PLATFORM }));
    expect(lastReq.value?.tier).toBe('industry');
  });

  it('routes tenant scope to tier=org', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ id: 'tn', scope: TENANT }));
    expect(lastReq.value?.tier).toBe('org');
  });

  it('uses refusal.reason as the nudge text when decision is a refusal', async () => {
    const { kernel } = makeKernel(refusal('blocked by inviolable gate'));
    const router = createNudgeRouter({
      kernel,
      dedupe: createInMemoryNudgeDedupe(),
    });
    const out = await router.route(intent());
    expect(out?.text).toBe('blocked by inviolable gate');
  });

  it('renders prompt without "Suggested action" line when none provided', async () => {
    const { kernel, lastReq } = makeKernel();
    const router = createNudgeRouter({ kernel, dedupe: createInMemoryNudgeDedupe() });
    await router.route(intent({ suggestedAction: null }));
    expect(lastReq.value?.userMessage).toMatch(/No suggested action; just inform\./);
    expect(lastReq.value?.userMessage).not.toMatch(/Suggested action:/);
  });

  it('marks dedupe with the provided clock timestamp', async () => {
    const fixed = new Date('2026-05-08T12:00:00Z');
    const { kernel } = makeKernel();
    const dedupe = createInMemoryNudgeDedupe();
    const router = createNudgeRouter({ kernel, dedupe, clock: () => fixed });
    const out = await router.route(intent());
    expect(out?.deliveredAt).toBe(fixed.toISOString());
  });
});

describe('createInMemoryNudgeDedupe', () => {
  it('reports false on unseen ids', async () => {
    const d = createInMemoryNudgeDedupe();
    expect(await d.isDuplicate('id-1', 1000)).toBe(false);
  });

  it('reports true while within cooldown window', async () => {
    const d = createInMemoryNudgeDedupe();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await d.markDelivered('id-1', new Date(1_000).toISOString());
    spy.mockReturnValue(1_500);
    expect(await d.isDuplicate('id-1', 1_000)).toBe(true);
    spy.mockRestore();
  });

  it('reports false once cooldown has elapsed', async () => {
    const d = createInMemoryNudgeDedupe();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await d.markDelivered('id-1', new Date(1_000).toISOString());
    spy.mockReturnValue(5_000);
    expect(await d.isDuplicate('id-1', 1_000)).toBe(false);
    spy.mockRestore();
  });
});
