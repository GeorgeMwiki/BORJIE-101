/**
 * Jarvis enforced-grounding tests — anti-hallucination hard rule on BOTH
 * Jarvis surfaces.
 *
 * CLAUDE.md hard rule: "Every junior recommendation cites >=1 evidence_id …
 * the Auditor Agent rejects responses with empty evidence chains." Before
 * this wiring the Jarvis `/think` + `/stream` paths shipped ungrounded model
 * prose unguarded. These tests pin the enforcement contract:
 *
 *   - /think, tenant-scoped, UNGROUNDED answer → WITHHELD: the ungrounded
 *     prose never reaches the client, a safe single-language message ships,
 *     and the status flips to 422 (HARD mode);
 *   - /think, tenant-scoped, GROUNDED answer → passes through at 200;
 *   - /think, PLATFORM scope → gate SKIPPED (no tenant corpus to ground
 *     against) even when ungrounded;
 *   - /think kill-switch `BORJIE_STRICT_EVIDENCE=off` → soft (ships at 200);
 *   - /stream, UNGROUNDED answer → a warn-only `auditor` frame is emitted
 *     before `done` (tokens were already streamed — warn, never withhold).
 *
 * The SovereignBrain is mocked so the kernel decision / stream is fully
 * deterministic without an ANTHROPIC_API_KEY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// Pin the HS256 JWT secret + skip dotenv BEFORE any router import so module
// init captures the deterministic test secret.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// ── Mock the sovereign brain so the kernel decision / stream is controllable.
// `decisionText` drives the /think answer prose; `streamDecision` drives the
// /stream `done` event's decision. Tests mutate these per-case.
let decisionText = 'ungrounded answer with no citation whatsoever.';
let streamText = 'ungrounded streamed answer with no citation.';

vi.mock('../../composition/sovereign', () => ({
  getSovereignBrain: async () => ({
    kernel: {
      think: async () => ({
        kind: 'answer',
        text: decisionText,
        provenance: { thoughtId: 'tho_test_1', latencyMs: 1 },
      }),
      // Async generator mirroring the kernel stream contract the router
      // consumes: turn_start → text_delta → done (with a final decision).
      async *thinkStream() {
        yield { kind: 'turn_start' };
        yield { kind: 'text_delta', text: streamText };
        yield {
          kind: 'done',
          decision: {
            kind: 'answer',
            text: streamText,
            provenance: { thoughtId: 'tho_stream_1', latencyMs: 1 },
          },
        };
      },
    },
  }),
}));

// The egress filter + ingress guard are exercised elsewhere; keep them inert
// here so the test focuses on the grounding gate (no redaction surprises).
// Both `guardFinal` (/think JSON) and `guardStream` (the streaming chokepoint
// inside guardKernelStream) must be stubbed or the stream delta fails closed.
vi.mock('../../composition/egress-filter-wiring.js', () => ({
  getEgressFilter: () => ({
    guardFinal: (text: string) => ({ text }),
    guardStream: (text: string) => ({ text }),
  }),
}));
vi.mock('../../composition/ingress-guard-apply.js', () => ({
  applyIngressGuard: async (args: { userText: string }) => ({
    refused: false,
    text: args.userText,
    raiseRail: false,
    refusalMessage: '',
    reasons: [],
  }),
  pickIngressGuardLang: () => 'en',
}));

import { createJarvisRouter } from '../jarvis-router-factory';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import { STRICT_WITHHOLD_TEXTS } from '../../composition/chat-response-gate';

const TENANT_BEARER = `Bearer ${generateToken({
  userId: 'usr-test',
  tenantId: 'tnt-test',
  role: UserRole.OWNER as never,
  permissions: ['*'],
  propertyAccess: ['*'],
})}`;

// Platform scope: the `platform-hq` SURFACE always yields `{ kind: 'platform' }`
// in scopeFromContext regardless of tenantId, so the grounding gate is skipped.
// (We keep a valid tenantId on the token so the auth boundary accepts it — an
// empty tenantId is rejected at sign-in, which is a separate concern.)
const PLATFORM_BEARER = `Bearer ${generateToken({
  userId: 'usr-hq',
  tenantId: 'tnt-hq',
  role: UserRole.SUPER_ADMIN as never,
  permissions: ['*'],
  propertyAccess: ['*'],
})}`;

function mount(): Hono {
  const app = new Hono();
  app.route(
    '/jarvis',
    createJarvisRouter({ surface: 'owner-portal', defaultTier: 'portfolio' }),
  );
  // A platform-hq router for the platform-scope skip test.
  app.route(
    '/jarvis-hq',
    createJarvisRouter({ surface: 'platform-hq', defaultTier: 'industry' }),
  );
  return app;
}

async function collectSseEventTypes(
  body: ReadableStream<Uint8Array> | null,
  maxMs = 4_000,
): Promise<{ types: string[]; frames: Record<string, string> }> {
  const types: string[] = [];
  const frames: Record<string, string> = {};
  if (!body) return { types, frames };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '';
  try {
    while (Date.now() - start < maxMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let evName = '';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) evName = line.slice(7).trim();
          if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (evName) {
          types.push(evName);
          frames[evName] = data;
        }
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { types, frames };
}

beforeEach(() => {
  decisionText = 'ungrounded answer with no citation whatsoever.';
  streamText = 'ungrounded streamed answer with no citation.';
  delete process.env.BORJIE_STRICT_EVIDENCE;
});

afterEach(() => {
  delete process.env.BORJIE_STRICT_EVIDENCE;
});

describe('jarvis /think — HARD-mode grounding enforcement', () => {
  it('WITHHOLDS an ungrounded tenant-scoped answer (422 + safe message, no prose leak)', async () => {
    const app = mount();
    const res = await app.request('/jarvis/think', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
        'accept-language': 'en',
      },
      body: JSON.stringify({ threadId: 't1', userMessage: 'should I sell?' }),
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    // The ungrounded provider prose must NOT leak …
    expect(JSON.stringify(json)).not.toContain('ungrounded answer');
    // … and the safe single-language message ships instead.
    expect(json.decision.text).toBe(STRICT_WITHHOLD_TEXTS.en);
    expect(json.audit.enforced).toBe(true);
    expect(json.audit.verdict).toBe('reject');
    expect(json.audit.evidenceCount).toBe(0);
  });

  it('PASSES a grounded tenant-scoped answer unchanged (200)', async () => {
    decisionText = 'The reserve is ~4,000 oz [evidence:lmbm_42].';
    const app = mount();
    const res = await app.request('/jarvis/think', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
      },
      body: JSON.stringify({ threadId: 't2', userMessage: 'reserve?' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.decision.text).toContain('[evidence:lmbm_42]');
    expect(json.audit.verdict).toBe('approve');
    expect(json.audit.enforced).toBe(false);
  });

  it('substitutes the SWAHILI safe message on a sw locale (no EN mixing)', async () => {
    const app = mount();
    const res = await app.request('/jarvis/think', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
        'accept-language': 'sw',
      },
      body: JSON.stringify({ threadId: 't3', userMessage: 'niuze?' }),
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as any;
    expect(json.decision.text).toBe(STRICT_WITHHOLD_TEXTS.sw);
    expect(json.decision.text).not.toMatch(/evidence|records|answer/i);
  });

  it('SKIPS the gate on platform scope even when ungrounded (200)', async () => {
    const app = mount();
    const res = await app.request('/jarvis-hq/think', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: PLATFORM_BEARER,
      },
      body: JSON.stringify({ threadId: 't4', userMessage: 'cohort trend?' }),
    });
    // Platform-scope (DP-cohort) has no tenant corpus → gate skipped, the
    // (ungrounded) answer ships at 200.
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.decision.text).toContain('ungrounded answer');
    expect(json.audit).toBeUndefined();
  });

  it('does NOT withhold when the kill-switch BORJIE_STRICT_EVIDENCE=off (soft)', async () => {
    process.env.BORJIE_STRICT_EVIDENCE = 'off';
    const app = mount();
    const res = await app.request('/jarvis/think', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
      },
      body: JSON.stringify({ threadId: 't5', userMessage: 'should I sell?' }),
    });
    // Strict OFF restores legacy observe-only: the verdict is still computed
    // (audit present) but the answer ships at 200.
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.decision.text).toContain('ungrounded answer');
    expect(json.audit.enforced).toBe(false);
    expect(json.audit.verdict).toBe('reject');
  });
});

describe('jarvis /stream — SOFT-mode grounding (warn-only auditor frame)', () => {
  it('emits a warn-only auditor frame before done; tokens are still sent', async () => {
    const app = mount();
    const res = await app.request('/jarvis/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
      },
      body: JSON.stringify({ threadId: 's1', userMessage: 'should I sell?' }),
    });
    expect(res.status).toBe(200);
    const { types, frames } = await collectSseEventTypes(res.body, 6_000);
    // The ungrounded tokens were still streamed (warn-only, not withheld) …
    expect(types).toContain('delta');
    expect(frames.delta).toContain('ungrounded streamed answer');
    // … and a warn-only auditor frame is emitted BEFORE done.
    expect(types).toContain('auditor');
    expect(types.indexOf('auditor')).toBeLessThan(types.indexOf('done'));
    const auditor = JSON.parse(frames.auditor);
    expect(auditor.mode).toBe('warn-only');
    expect(auditor.verdict).toBe('reject');
    expect(auditor.evidenceCount).toBe(0);
  });

  it('a grounded streamed answer reports an approve auditor frame', async () => {
    streamText = 'Grade looks strong [evidence:lmbm_77].';
    const app = mount();
    const res = await app.request('/jarvis/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: TENANT_BEARER,
      },
      body: JSON.stringify({ threadId: 's2', userMessage: 'grade?' }),
    });
    expect(res.status).toBe(200);
    const { frames } = await collectSseEventTypes(res.body, 6_000);
    const auditor = JSON.parse(frames.auditor);
    expect(auditor.mode).toBe('warn-only');
    expect(auditor.verdict).toBe('approve');
    expect(auditor.evidenceCount).toBeGreaterThan(0);
  });
});
