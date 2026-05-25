/**
 * Sovereign-brain composition tests — drives the FULL stack a real
 * api-gateway would compose: composeSovereign() → kernel → briefing →
 * four-eye approvals → nudges. No mocks beyond a stub Sensor (the
 * Anthropic SDK isn't required for unit tests).
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  personalisePersona,
  SOVEREIGN_ADMIN_PERSONA,
  selectPersona,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type UserProfile,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const PROFILE: UserProfile = {
  userId: 'u_jane',
  displayName: 'Jane Mwikila',
  role: 'platform admin',
  affiliation: 'Borjie HQ',
  greetingStyle: 'warm',
};

const SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_jane',
  roles: ['platform-admin'],
  personaId: 'sovereign-admin',
};

function stubSensor(text: string): Sensor {
  return {
    id: 'stub',
    modelId: 'stub-1',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_a: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'stub-1',
        sensorId: 'stub',
      };
    },
  };
}

describe('personalisePersona', () => {
  it('greets the user by first name and references their role', () => {
    const personalised = personalisePersona(SOVEREIGN_ADMIN_PERSONA, PROFILE);
    expect(personalised.openingStatement).toContain('Hello Jane');
    expect(personalised.openingStatement).toContain('platform admin');
    expect(personalised.openingStatement).toContain('Borjie HQ');
    expect(personalised.id.endsWith(`::${PROFILE.userId}`)).toBe(true);
  });
});

describe('surface → persona routing', () => {
  it('maps platform-hq to SOVEREIGN_ADMIN_PERSONA (Nyumba Mind for HQ)', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });
    expect(persona.id).toBe('sovereign-admin');
  });

  it('maps admin-portal (deprecated) to OWNER_ADVISOR — owner IS the admin', () => {
    // Consolidated 4-portal model: owner-portal IS the admin portal.
    // /api/v1/admin/jarvis stays for backwards-compat but routes to
    // the same OWNER_ADVISOR persona as /api/v1/owner/jarvis.
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...SCOPE, kind: 'tenant', tenantId: 't_acme' } as any,
      tier: 'org',
      stakes: 'low',
      surface: 'admin-portal',
    });
    expect(persona.id).toBe('owner-advisor');
    expect(persona.firstPersonNoun).toBe('we');
  });

  it('maps tenant-app to TENANT_RESIDENT_PERSONA', () => {
    const persona = selectPersona({
      threadId: 't',
      userMessage: 'q',
      scope: { ...SCOPE, kind: 'tenant', tenantId: 't_acme' } as any,
      tier: 'lease',
      stakes: 'low',
      surface: 'tenant-app',
    });
    expect(persona.id).toBe('tenant-resident');
  });

  it('personalises every persona with the operator\'s name', () => {
    const surfaces = ['tenant-app', 'owner-portal', 'estate-manager-app', 'admin-portal', 'platform-hq'] as const;
    for (const s of surfaces) {
      const base = selectPersona({
        threadId: 't', userMessage: 'q',
        scope: s === 'platform-hq' ? SCOPE : ({ ...SCOPE, kind: 'tenant', tenantId: 't_acme' } as any),
        tier: s === 'platform-hq' ? 'industry' : 'org',
        stakes: 'low',
        surface: s,
      });
      const personalised = personalisePersona(base, PROFILE);
      expect(personalised.openingStatement).toContain('Jane');
      expect(personalised.id.endsWith(`::${PROFILE.userId}`)).toBe(true);
    }
  });
});

describe('composeSovereign — full stack', () => {
  it('composes a working kernel + approvals + briefing + nudges', async () => {
    const sov = composeSovereign({
      extraSensors: [stubSensor('All quiet on the estate.')],
    });

    const decision = await sov.kernel.think({
      threadId: 'th-1',
      userMessage: 'How is collection going?',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'admin-portal',
    });
    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(true);

    const briefing = await sov.briefing.compose({
      day: '2026-05-05',
      user: PROFILE,
      scope: SCOPE,
      threadId: 'th-2',
      dataPoints: [
        { topic: 'Collection', summary: 'On track', severity: 'info' },
        { topic: 'Vacancies', summary: '2 longer than 30 days', severity: 'warn' },
      ],
      topPriority: { topic: 'Vacancies', summary: '2 longer than 30 days', severity: 'warn' },
    });
    expect(briefing.bullets.length).toBe(2);
    expect(briefing.headline.length).toBeGreaterThan(0);

    const nudge = await sov.nudges.route({
      id: 'arrears-spike-2026-05-05',
      user: PROFILE,
      scope: SCOPE,
      threadId: 'th-3',
      trigger: 'Arrears index ticked 12% above cohort baseline.',
      severity: 'warn',
      suggestedAction: 'Open the arrears ladder for unit A12.',
      proposedAt: new Date().toISOString(),
    });
    expect(nudge?.severity).toBe('warn');

    // Repeat the same nudge intent — dedupe should suppress it.
    const repeat = await sov.nudges.route({
      id: 'arrears-spike-2026-05-05',
      user: PROFILE,
      scope: SCOPE,
      threadId: 'th-3',
      trigger: 'Arrears index ticked 12% above cohort baseline.',
      severity: 'warn',
      suggestedAction: null,
      proposedAt: new Date().toISOString(),
    });
    expect(repeat).toBeNull();
  });
});

describe('per-user brain isolation — no cache bleed across users', () => {
  it('two users in the same tenant get DIFFERENT thoughtIds for the same question', async () => {
    const sov = composeSovereign({
      extraSensors: [stubSensor('All quiet on the estate.')],
    });

    const tenantScopeA: ScopeContext = {
      kind: 'tenant',
      tenantId: 't_acme',
      actorUserId: 'u_alpha',
      roles: ['estate-manager'],
      personaId: 'estate-manager',
    };
    const tenantScopeB: ScopeContext = {
      ...tenantScopeA,
      actorUserId: 'u_beta',
    };

    const decisionA = await sov.kernel.think({
      threadId: 'th-shared',
      userMessage: 'How is collection going?',
      scope: tenantScopeA,
      tier: 'org',
      stakes: 'low',
      surface: 'estate-manager-app',
    });
    const decisionB = await sov.kernel.think({
      threadId: 'th-shared',
      userMessage: 'How is collection going?',
      scope: tenantScopeB,
      tier: 'org',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    // If the cache were keyed without actorUserId, B would be a cache hit
    // of A and the thoughtIds would match. They must not.
    expect(decisionA.provenance.thoughtId).not.toBe(decisionB.provenance.thoughtId);
  });
});

describe('four-eye approval gate', () => {
  it('rejects self-approval, requires 2 distinct approvers', async () => {
    const sov = composeSovereign({ extraSensors: [stubSensor('ok')] });
    const r1 = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-x',
      summary: 'Apply rent waiver to lease L-1',
      toolName: 'rent.waiver',
      payload: { leaseId: 'L-1', amount: 100000 },
      stakes: 'high',
    });
    expect(r1.status).toBe('pending');

    await expect(
      sov.approvals.sign({
        actionId: r1.action.id,
        approverUserId: 'u_jane',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/self-approve/);

    const r2 = await sov.approvals.sign({
      actionId: r1.action.id,
      approverUserId: 'u_alice',
      verdict: 'approve',
    });
    expect(r2.status).toBe('one-eye');

    await expect(
      sov.approvals.sign({
        actionId: r1.action.id,
        approverUserId: 'u_alice',
        verdict: 'approve',
      }),
    ).rejects.toThrow(/already signed/);

    const r3 = await sov.approvals.sign({
      actionId: r1.action.id,
      approverUserId: 'u_bob',
      verdict: 'approve',
    });
    expect(r3.status).toBe('approved');
    expect(r3.signatures).toHaveLength(2);
  });

  it('rejects on a single veto', async () => {
    const sov = composeSovereign({ extraSensors: [stubSensor('ok')] });
    const r1 = await sov.approvals.propose({
      proposerUserId: 'u_jane',
      thoughtId: 'th-y',
      summary: 'Terminate lease L-2',
      toolName: 'lease.terminate',
      payload: { leaseId: 'L-2' },
      stakes: 'critical',
    });
    const r2 = await sov.approvals.sign({
      actionId: r1.action.id,
      approverUserId: 'u_alice',
      verdict: 'reject',
      comment: 'Tenant has open dispute',
    });
    expect(r2.status).toBe('rejected');
  });
});

describe('Anthropic sensor adapter — uses a stub messages client', () => {
  it('serializes prior turns and parses content blocks', async () => {
    const { createAnthropicSensor } = await import('../kernel/sensors/anthropic-sensor.js');
    const calls: Array<unknown> = [];
    const stubClient = {
      messages: {
        async create(args: any) {
          calls.push(args);
          return {
            id: 'm_1',
            model: args.model,
            stop_reason: 'end_turn',
            content: [
              { type: 'thinking', thinking: 'considering...' },
              { type: 'text', text: 'Got it, here is the plan.' },
              { type: 'tool_use', id: 'tu_a', name: 'graph.query', input: { q: 'X' } },
            ],
          };
        },
      },
    };
    const sensor = createAnthropicSensor(stubClient as any, {
      id: 'opus',
      modelId: 'claude-opus-4-7',
      priority: 1,
      capabilities: ['thinking', 'fast'],
    });
    const result = await sensor.call({
      system: 'You are X.',
      userMessage: 'Hi',
      priorTurns: [{ role: 'user', content: 'Earlier' }],
      extendedThinking: true,
      stakes: 'high',
    });
    expect(result.text).toBe('Got it, here is the plan.');
    expect(result.thought).toContain('considering');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe('graph.query');
    const callArgs = calls[0] as any;
    expect(callArgs.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(callArgs.messages).toHaveLength(2);
  });
});
