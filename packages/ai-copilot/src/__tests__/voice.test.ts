/**
 * Voice AI tests (Wave 11).
 *
 * Covers provider construction, router routing by language, Swahili fallback,
 * cost logging, invalid-audio handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElevenLabsProvider } from '../voice/elevenlabs-provider.js';
import { OpenAIVoiceProvider } from '../voice/openai-voice-provider.js';
import { createVoiceRouter } from '../voice/voice-router.js';
import {
  createCostLedger,
  type AiCostEntry,
  type CostLedgerRepository,
  type TenantAiBudget,
} from '../cost-ledger.js';
import { createVoiceSession } from '../voice/voice-session.js';

function makeRepo() {
  const entries: AiCostEntry[] = [];
  const budgets = new Map<string, TenantAiBudget>();
  const repo: CostLedgerRepository = {
    async insertEntry(e) {
      entries.push({ ...e });
      return { ...e };
    },
    async sumUsage(tenantId, from, to) {
      const scoped = entries.filter(
        (e) =>
          e.tenantId === tenantId &&
          new Date(e.occurredAt).getTime() >= from.getTime() &&
          new Date(e.occurredAt).getTime() < to.getTime()
      );
      return {
        totalCostUsdMicro: scoped.reduce((a, b) => a + b.costUsdMicro, 0),
        totalInputTokens: scoped.reduce((a, b) => a + b.inputTokens, 0),
        totalOutputTokens: scoped.reduce((a, b) => a + b.outputTokens, 0),
        callCount: scoped.length,
        byModel: {},
      };
    },
    async listRecent() {
      return [];
    },
    async getBudget(tenantId) {
      return budgets.get(tenantId) ?? null;
    },
    async upsertBudget(b) {
      budgets.set(b.tenantId, b);
      return b;
    },
  };
  return { entries, budgets, repo };
}

describe('ElevenLabsProvider construction', () => {
  it('throws without apiKey', () => {
    expect(() => new ElevenLabsProvider({ apiKey: '', defaultVoiceId: 'v1' })).toThrow();
  });
  it('throws without defaultVoiceId', () => {
    expect(() => new ElevenLabsProvider({ apiKey: 'x', defaultVoiceId: '' })).toThrow();
  });
  it('supports en/sw/mixed', () => {
    const p = new ElevenLabsProvider({ apiKey: 'x', defaultVoiceId: 'v1' });
    expect(p.supportsLanguage('en')).toBe(true);
    expect(p.supportsLanguage('sw')).toBe(true);
    expect(p.supportsLanguage('mixed')).toBe(true);
  });
});

describe('OpenAIVoiceProvider construction', () => {
  it('throws without apiKey', () => {
    expect(() => new OpenAIVoiceProvider({ apiKey: '' })).toThrow();
  });
  it('does not support Swahili', () => {
    const p = new OpenAIVoiceProvider({ apiKey: 'x' });
    expect(p.supportsLanguage('en')).toBe(true);
    expect(p.supportsLanguage('sw')).toBe(false);
  });
});

describe('VoiceRouter.transcribe', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('logs cost to ledger on success', async () => {
    const { repo, entries } = makeRepo();
    const ledger = createCostLedger({ repo });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'hi', duration_seconds: 3 }), { status: 200 })
    ) as typeof globalThis.fetch;
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const router = createVoiceRouter({ providers: { elevenlabs: eleven }, ledger });
    const r = await router.transcribe(
      { tenantId: 't1', userId: 'u' },
      { audio: new Uint8Array([1, 2, 3]), language: 'en' }
    );
    expect(r.success).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].provider).toBe('elevenlabs');
    globalThis.fetch = originalFetch;
  });

  it('Swahili skips OpenAI when ElevenLabs unavailable returns error', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const oa = new OpenAIVoiceProvider({ apiKey: 'k' });
    const router = createVoiceRouter({ providers: { openai: oa }, ledger });
    const r = await router.transcribe(
      { tenantId: 't1' },
      { audio: new Uint8Array([1]), language: 'sw' }
    );
    expect(r.success).toBe(false);
  });

  it('rejects invalid audio', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const router = createVoiceRouter({ providers: { elevenlabs: eleven }, ledger });
    const r = await router.transcribe(
      { tenantId: 't1' },
      { audio: new Uint8Array(0), language: 'en' }
    );
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('INVALID_AUDIO');
  });

  it('falls back from ElevenLabs 5xx to OpenAI for English', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    let call = 0;
    globalThis.fetch = vi.fn(async (input: any) => {
      call += 1;
      const url = String(input);
      if (url.includes('elevenlabs')) {
        return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
      }
      return new Response(
        JSON.stringify({ text: 'fallback', duration: 1 }),
        { status: 200 }
      );
    }) as typeof globalThis.fetch;
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const oa = new OpenAIVoiceProvider({ apiKey: 'k2' });
    const router = createVoiceRouter({
      providers: { elevenlabs: eleven, openai: oa },
      ledger,
    });
    const r = await router.transcribe(
      { tenantId: 't1' },
      { audio: new Uint8Array([1, 2, 3]), language: 'en' }
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.text).toBe('fallback');
    globalThis.fetch = originalFetch;
  });
});

describe('VoiceRouter.synthesize', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('rejects empty text', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const router = createVoiceRouter({ providers: { elevenlabs: eleven }, ledger });
    const r = await router.synthesize(
      { tenantId: 't1' },
      { text: '', language: 'en' }
    );
    expect(r.success).toBe(false);
  });

  it('prefers ElevenLabs for Swahili', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      expect(url).toContain('elevenlabs');
      const body = new Uint8Array([1, 2, 3, 4]);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }) as typeof globalThis.fetch;
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const oa = new OpenAIVoiceProvider({ apiKey: 'k2' });
    const router = createVoiceRouter({
      providers: { elevenlabs: eleven, openai: oa },
      ledger,
    });
    const r = await router.synthesize(
      { tenantId: 't1' },
      { text: 'habari', language: 'sw' }
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerId).toBe('elevenlabs');
    globalThis.fetch = originalFetch;
  });
});

describe('VoiceSession', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  it('transcribes, responds, synthesizes — one turn', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('speech-to-text')) {
        return new Response(JSON.stringify({ text: 'hi', duration_seconds: 1 }), { status: 200 });
      }
      return new Response(new Uint8Array([5, 6, 7]), { status: 200 });
    }) as typeof globalThis.fetch;
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const router = createVoiceRouter({ providers: { elevenlabs: eleven }, ledger });
    const session = createVoiceSession({
      voiceRouter: router,
      language: 'en',
      responder: {
        async respond({ transcript }) {
          return { text: `you said: ${transcript}`, providerId: 'test-llm' };
        },
      },
    });
    const result = await session.turn(
      { tenantId: 't1' },
      new Uint8Array([1, 2, 3])
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transcript).toBe('hi');
      expect(result.data.assistantText).toContain('you said');
    }
    expect(session.session.turns).toHaveLength(2);
    globalThis.fetch = originalFetch;
  });

  it('ended session refuses further turns', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const eleven = new ElevenLabsProvider({ apiKey: 'k', defaultVoiceId: 'v' });
    const router = createVoiceRouter({ providers: { elevenlabs: eleven }, ledger });
    const session = createVoiceSession({
      voiceRouter: router,
      language: 'en',
      responder: { async respond() { return { text: '' }; } },
    });
    session.end();
    const r = await session.turn({ tenantId: 't1' }, new Uint8Array([1]));
    expect(r.success).toBe(false);
  });
});
