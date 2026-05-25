/**
 * Voice-agent wiring tests — verify the composition module:
 *   1. returns null when the database client is null
 *   2. returns a wiring with `.agent` when the database is present
 *   3. round-trips a real `agent.turn(...)` call against a fake DB
 *      (inline transcript bypasses STT, no TTS configured ⇒ degraded)
 *   4. emits the degraded-mode VOICE_BRAIN_NOT_CONFIGURED model tag
 *      and a localized polite reply when the brain stub fires
 *   5. resolves customerId to null when no resolver port is wired
 *   6. uses the heuristic language detector — never hard-codes `en`
 *
 * The fake DatabaseClient mimics the surface that `createVoiceTurnsService`
 * touches (`db.insert(table).values(...)` and the chained `select` for
 * `countBySession`). It is deliberately minimal — we are not testing the
 * Drizzle adapter here; that is covered by
 * `packages/database/src/services/voice-turns.service.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createVoiceAgentWiring,
  type KernelBrainDecisionLike,
  type KernelThinkFn,
  type KernelThoughtRequestLike,
} from '../voice-agent-wiring';

// ---------------------------------------------------------------------------
// Fake DatabaseClient — supports the two call shapes the wiring exercises:
// `insert(table).values(...)` from the storage adapter's insert path, and
// `select(...).from(...).where(...)` for countBySession (returns 0 rows
// initially, then we increment the count manually after each insert).
// ---------------------------------------------------------------------------

interface FakeDbHandle {
  client: unknown;
  readonly inserted: ReadonlyArray<Record<string, unknown>>;
}

function createFakeDb(): FakeDbHandle {
  const inserted: Record<string, unknown>[] = [];
  let count = 0;

  const client = {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        inserted.push(v);
        count += 1;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ value: count }]),
      }),
    }),
  };

  return {
    client,
    get inserted() {
      return inserted;
    },
  };
}

describe('createVoiceAgentWiring', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns null when db is null', () => {
    const wiring = createVoiceAgentWiring({ db: null });
    expect(wiring).toBeNull();
  });

  it('returns wiring with .agent when db is present', () => {
    const fake = createFakeDb();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
    });
    expect(wiring).not.toBeNull();
    expect(wiring?.agent).toBeDefined();
    expect(typeof wiring?.agent.turn).toBe('function');
  });

  it('agent.turn() round-trips an English transcript and persists a row', async () => {
    const fake = createFakeDb();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
    });
    expect(wiring).not.toBeNull();

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's1',
      transcript: 'Hello, can you help me with my rent?',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.sessionId).toBe('s1');
    expect(result.data.detectedLanguage).toBe('en');
    expect(result.data.degradedMode).toBe(true);
    expect(result.data.responseText.length).toBeGreaterThan(0);
    expect(fake.inserted).toHaveLength(1);
    const row = fake.inserted[0]!;
    expect(row.tenantId).toBe('t1');
    expect(row.sessionId).toBe('s1');
    expect(row.modelVersion).toBe('VOICE_BRAIN_NOT_CONFIGURED');
  });

  it('brain stub responds in Swahili when transcript carries Swahili cues', async () => {
    const fake = createFakeDb();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
    });

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's2',
      transcript: 'Habari, ninahitaji msaada na nyumba yangu',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.detectedLanguage).toBe('sw');
    // Swahili degraded-mode reply should contain a Swahili-specific token.
    expect(result.data.responseText.toLowerCase()).toContain('asante');
    expect(result.data.modelVersion).toBe('VOICE_BRAIN_NOT_CONFIGURED');
  });

  it('resolves customerId to null when no resolver is wired', async () => {
    const fake = createFakeDb();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
    });

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's3',
      transcript: 'Bonjour, j’ai une question',
      callerPhone: '+255700000000',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.customerId).toBeNull();
    expect(result.data.detectedLanguage).toBe('fr');
  });

  it('passes a logger warning through the brain stub when configured', async () => {
    const fake = createFakeDb();
    const warn = vi.fn();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
      logger: { warn },
    });

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's4',
      transcript: 'Hola, necesito ayuda',
    });

    expect(result.success).toBe(true);
    // Two warnings: one at brain-stub install (KERNEL_NOT_WIRED) and
    // one at turn time (VOICE_BRAIN_NOT_CONFIGURED).
    expect(warn).toHaveBeenCalledTimes(2);
    const installCall = warn.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(installCall[0].degraded_reason).toBe('KERNEL_NOT_WIRED');
    expect(installCall[0].port).toBe('VoiceBrainPort');

    const turnCall = warn.mock.calls[1] as [
      Record<string, unknown>,
      string,
    ];
    expect(turnCall[0].tenantId).toBe('t1');
    expect(turnCall[0].sessionId).toBe('s4');
    expect(turnCall[0].languageCode).toBe('es');
    expect(turnCall[1]).toContain('VOICE_BRAIN_NOT_CONFIGURED');
  });

  // ─────────────────────────────────────────────────────────────────
  // Real-brain (kernelThink) path — the central-intelligence kernel
  // adapter. Tests use a stub `kernelThink` so we don't pull the
  // kernel runtime into this package's test surface.
  // ─────────────────────────────────────────────────────────────────

  it('routes voice turns through kernelThink when provided (real brain path)', async () => {
    const fake = createFakeDb();
    const kernelThink = vi.fn<KernelThinkFn>(async () => {
      const decision: KernelBrainDecisionLike = {
        kind: 'answer',
        text: 'Your balance is TZS 200,000 and your next rent is due on the 1st.',
        provenance: { modelId: 'claude-sonnet-4-5' },
      };
      return decision;
    });

    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
      kernelThink,
    });
    expect(wiring).not.toBeNull();

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's-real-1',
      transcript: 'How much do I owe this month?',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(kernelThink).toHaveBeenCalledTimes(1);
    expect(result.data.responseText).toContain('TZS 200,000');
    expect(result.data.modelVersion).toBe('claude-sonnet-4-5');
    expect(result.data.degradedMode).toBe(true); // STT/TTS still null
    expect(fake.inserted).toHaveLength(1);
    expect((fake.inserted[0] as { modelVersion?: string }).modelVersion).toBe(
      'claude-sonnet-4-5',
    );
  });

  it('falls back to heuristic stub when kernelThink is undefined', async () => {
    const fake = createFakeDb();
    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
      // kernelThink intentionally omitted
    });

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's-fallback',
      transcript: 'Habari, ninahitaji msaada',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.detectedLanguage).toBe('sw');
    expect(result.data.modelVersion).toBe('VOICE_BRAIN_NOT_CONFIGURED');
    expect(result.data.responseText.toLowerCase()).toContain('asante');
  });

  it('builds a tenant-scoped ThoughtRequest with the session id as threadId', async () => {
    const fake = createFakeDb();
    const captured: KernelThoughtRequestLike[] = [];
    const kernelThink: KernelThinkFn = async (req) => {
      captured.push(req);
      const decision: KernelBrainDecisionLike = {
        kind: 'answer',
        text: 'Acknowledged.',
        provenance: { modelId: 'claude-haiku-4-5' },
      };
      return decision;
    };

    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
      kernelThink,
    });

    await wiring!.agent.turn({
      tenantId: 'tenant-XYZ',
      sessionId: 'sess-42',
      transcript: 'Bonjour, j’ai une question',
    });

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.threadId).toBe('sess-42');
    expect(req.userMessage).toBe('Bonjour, j’ai une question');
    expect(req.tier).toBe('tenant');
    expect(req.surface).toBe('tenant-app');
    expect(req.stakes).toBe('medium');
    expect(req.scope.kind).toBe('tenant');
    if (req.scope.kind === 'tenant') {
      expect(req.scope.tenantId).toBe('tenant-XYZ');
      // Anonymous caller (no resolver) → derived per-session actor id.
      expect(req.scope.actorUserId).toBe('voice-session:sess-42');
      expect(req.scope.roles).toEqual(['tenant']);
      expect(req.scope.personaId).toBe('voice-agent-default');
    }
  });

  it('degrades politely when kernelThink throws', async () => {
    const fake = createFakeDb();
    const warn = vi.fn();
    const kernelThink: KernelThinkFn = async () => {
      throw new Error('upstream sensor outage');
    };

    const wiring = createVoiceAgentWiring({
      db: fake.client as never,
      kernelThink,
      logger: { warn },
    });

    const result = await wiring!.agent.turn({
      tenantId: 't1',
      sessionId: 's-throw',
      transcript: 'Hello, anybody home?',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modelVersion).toBe('VOICE_BRAIN_KERNEL_ERROR');
    expect(result.data.responseText.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    const matched = warn.mock.calls.find(
      ([meta]) =>
        (meta as Record<string, unknown>).degraded_reason ===
        'KERNEL_THINK_FAILED',
    );
    expect(matched).toBeDefined();
  });
});
