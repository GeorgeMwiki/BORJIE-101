/**
 * Kernel memory-hierarchy wiring tests.
 *
 * Mounts the kernel through `composeSovereign` with a stub sensor and
 * a hand-rolled MemoryHierarchy, then asserts:
 *
 *   1. semantic facts are mixed into the system prompt the sensor sees
 *      ("What I remember about you:")
 *   2. the latest weekly reflective digest is mixed in
 *      ("Recent reflection:")
 *   3. episodic.record is fired twice per turn (user-message + agent-
 *      action), with the user's message and the agent's text
 *   4. a failing memory port (semantic / reflective / episodic each)
 *      does NOT break the turn — kernel still produces a decision
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeSovereign,
  type EpisodicMemoryPort,
  type EpisodicRecordArgs,
  type MemoryHierarchy,
  type ProceduralMemoryPort,
  type ReflectiveDigest,
  type ReflectiveMemoryPort,
  type ScopeContext,
  type SemanticFact,
  type SemanticMemoryPort,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function captureSensor(): {
  sensor: Sensor;
  systems: string[];
} {
  const systems: string[] = [];
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-1',
    priority: 1,
    capabilities: ['fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      systems.push(args.system);
      return {
        text: 'ack',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'capture-1',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, systems };
}

function semanticPort(facts: ReadonlyArray<SemanticFact>, opts?: { fail?: boolean }): SemanticMemoryPort {
  return {
    async upsertFact() {
      /* no-op */
    },
    async lookup() {
      return null;
    },
    async search() {
      if (opts?.fail) throw new Error('semantic-down');
      return facts;
    },
    async decay() {
      return 0;
    },
  };
}

function reflectivePort(
  digest: ReflectiveDigest | null,
  opts?: { fail?: boolean },
): ReflectiveMemoryPort {
  return {
    async latest() {
      if (opts?.fail) throw new Error('reflective-down');
      return digest ? [digest] : [];
    },
    async record() {
      /* no-op */
    },
  };
}

function episodicPort(opts?: { fail?: boolean }): {
  port: EpisodicMemoryPort;
  records: EpisodicRecordArgs[];
} {
  const records: EpisodicRecordArgs[] = [];
  const port: EpisodicMemoryPort = {
    async record(args) {
      records.push(args);
      if (opts?.fail) throw new Error('episodic-down');
    },
    async recall() {
      return [];
    },
    async purgeExpired() {
      return 0;
    },
  };
  return { port, records };
}

function proceduralPort(): ProceduralMemoryPort {
  return {
    async record() {
      /* no-op */
    },
    async match() {
      return [];
    },
  };
}

const SAMPLE_FACT: SemanticFact = {
  id: 'sf1',
  tenantId: 't_demo',
  userId: 'u_alice',
  key: 'language.preferred',
  value: 'sw',
  confidence: 0.92,
  sourceTurnId: null,
  evidenceCount: 4,
  firstSeenAt: '2026-04-01T00:00:00.000Z',
  lastSeenAt: '2026-04-30T00:00:00.000Z',
  expiresAt: null,
  source: 'declared',
};

const SAMPLE_DIGEST: ReflectiveDigest = {
  id: 'd1',
  tenantId: 't_demo',
  userId: 'u_alice',
  periodKind: 'weekly',
  periodStart: '2026-04-27T00:00:00.000Z',
  periodEnd: '2026-05-04T00:00:00.000Z',
  summary: 'Asked 14 times about vacancy this week; sentiment trending negative.',
  topTopics: [{ topic: 'vacancy', count: 14 }],
  sentimentAvg: -0.2,
  actionItems: ['Run a vacancy strategy review'],
  generatedAt: '2026-05-05T00:00:00.000Z',
};

describe('memory-hierarchy wiring', () => {
  it('mixes semantic facts into the system prompt the sensor sees', async () => {
    const { sensor, systems } = captureSensor();
    const memory: MemoryHierarchy = {
      semantic: semanticPort([SAMPLE_FACT]),
      procedural: proceduralPort(),
    };
    const sov = composeSovereign({ extraSensors: [sensor], memory });

    await sov.kernel.think({
      threadId: 't1',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(systems[0]).toContain('What I remember about you:');
    expect(systems[0]).toContain('language.preferred');
    expect(systems[0]).toContain('sw');
    expect(systems[0]).toContain('92%');
  });

  it('mixes the latest reflective digest into the system prompt', async () => {
    const { sensor, systems } = captureSensor();
    const memory: MemoryHierarchy = {
      reflective: reflectivePort(SAMPLE_DIGEST),
    };
    const sov = composeSovereign({ extraSensors: [sensor], memory });

    await sov.kernel.think({
      threadId: 't1',
      userMessage: 'how was last week?',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(systems[0]).toContain('Recent reflection:');
    expect(systems[0]).toContain('vacancy');
    expect(systems[0]).toContain('sentiment trending negative');
  });

  it('records two episodic entries per turn (user-message + agent-action)', async () => {
    const { sensor } = captureSensor();
    const ep = episodicPort();
    const memory: MemoryHierarchy = { episodic: ep.port };
    const sov = composeSovereign({ extraSensors: [sensor], memory });

    await sov.kernel.think({
      threadId: 't_alpha',
      userMessage: 'asks about lease L-417',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    // Episodic writes are fire-and-forget — let the microtask queue
    // drain so the spy captures both.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ep.records.length).toBe(2);
    const kinds = ep.records.map((r) => r.kind).sort();
    expect(kinds).toEqual(['agent-action', 'user-message']);
    const userRecord = ep.records.find((r) => r.kind === 'user-message');
    expect(userRecord?.summary).toBe('asks about lease L-417');
    expect(userRecord?.threadId).toBe('t_alpha');
    expect(userRecord?.userId).toBe('u_alice');
    const agentRecord = ep.records.find((r) => r.kind === 'agent-action');
    expect(agentRecord?.summary).toBe('ack');
  });

  it('a failing memory port does NOT break the turn', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sensor } = captureSensor();
    const ep = episodicPort({ fail: true });
    const memory: MemoryHierarchy = {
      semantic: semanticPort([], { fail: true }),
      reflective: reflectivePort(null, { fail: true }),
      episodic: ep.port,
    };
    const sov = composeSovereign({ extraSensors: [sensor], memory });

    const decision = await sov.kernel.think({
      threadId: 't_failing',
      userMessage: 'still works?',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });

    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(
      true,
    );
    errSpy.mockRestore();
  });
});
