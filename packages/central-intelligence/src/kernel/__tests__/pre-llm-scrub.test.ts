/**
 * A2b-2 wires #1 + #2 — pre-LLM PII scrub at the sensor egress AND
 * at the episodic-memory persistence boundary.
 *
 * Asserts the sensor receives the SCRUBBED user message (so the
 * third-party LLM never sees raw email/phone/NIDA/KRA/API-key) and
 * that `memory.episodic.record(...)` is called with the same
 * scrubbed text (so `kernel_memory_episodic.summary` cannot leak
 * raw PII even though that table is not in the RTBF list).
 */
import { describe, it, expect } from 'vitest';
import {
  createBrainKernel,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
  type MemoryHierarchy,
} from '../index.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function spySensor(): {
  sensor: Sensor;
  lastArgs: { value: SensorCallArgs | null };
} {
  const lastArgs: { value: SensorCallArgs | null } = { value: null };
  const sensor: Sensor = {
    id: 'spy-sensor',
    modelId: 'spy-model',
    priority: 10,
    capabilities: ['thinking', 'fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      lastArgs.value = args;
      return {
        text: 'ack',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'spy-model',
        sensorId: 'spy-sensor',
      };
    },
  };
  return { sensor, lastArgs };
}

function spyMemory(): {
  memory: MemoryHierarchy;
  episodicRecords: Array<{ summary: string; kind: string }>;
} {
  const episodicRecords: Array<{ summary: string; kind: string }> = [];
  const memory: MemoryHierarchy = {
    semantic: {
      async search() { return []; },
    } as MemoryHierarchy['semantic'],
    episodic: {
      async record(args) {
        episodicRecords.push({ summary: args.summary, kind: args.kind });
      },
    } as MemoryHierarchy['episodic'],
    reflective: {
      async latest() { return null; },
    } as MemoryHierarchy['reflective'],
  } as MemoryHierarchy;
  return { memory, episodicRecords };
}

const REQ_BASE: Omit<ThoughtRequest, 'userMessage'> = {
  threadId: 'thread-1',
  scope: TENANT_SCOPE,
  tier: 'property',
  stakes: 'medium',
  surface: 'estate-manager-app',
};

describe('A2b-2 wire #1 — pre-LLM PII scrub at sensor egress', () => {
  it('passes a SCRUBBED userMessage to router.call (email + KRA-PIN + phone)', async () => {
    const { sensor, lastArgs } = spySensor();
    const kernel = createBrainKernel({ sensors: [sensor] });
    const req: ThoughtRequest = {
      ...REQ_BASE,
      userMessage:
        'My email is alice@example.com, KRA pin P987654321Q and call +255 712 345 678 please.',
    };
    await kernel.think(req);
    expect(lastArgs.value).not.toBeNull();
    const got = lastArgs.value!.userMessage;
    expect(got).not.toContain('alice@example.com');
    expect(got).not.toContain('P987654321Q');
    expect(got).not.toMatch(/\+?255[\s-]?712[\s-]?345[\s-]?678/);
    // Replacement tokens documented in pii-scrub-cot.ts.
    expect(got).toMatch(/\[redacted-email\]|\[redacted-kra-pin\]|\[redacted-phone\]/);
  });
});

describe('A2b-2 wire #2 — episodic memory persist scrub', () => {
  it('writes a SCRUBBED summary into kernel_memory_episodic', async () => {
    const { sensor } = spySensor();
    const { memory, episodicRecords } = spyMemory();
    const kernel = createBrainKernel({ sensors: [sensor], memory });
    const req: ThoughtRequest = {
      ...REQ_BASE,
      userMessage: 'Reach me on +255 712 345 678 or alice@example.com',
    };
    await kernel.think(req);
    // Episodic memory is fire-and-forget — schedule on microtask queue.
    await new Promise((r) => setTimeout(r, 5));
    const userEcho = episodicRecords.find((r) => r.kind === 'user-message');
    expect(userEcho).toBeDefined();
    expect(userEcho!.summary).not.toContain('alice@example.com');
    expect(userEcho!.summary).not.toMatch(/\+?255[\s-]?712[\s-]?345[\s-]?678/);
    expect(userEcho!.summary).toMatch(/\[redacted-email\]|\[redacted-phone\]/);
  });
});
