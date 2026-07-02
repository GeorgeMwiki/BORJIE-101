/**
 * Jarvis /stream — terminal `error` frame handling (D19, HONEST MID-STREAM
 * DEGRADE regression).
 *
 * The kernel emits a TERMINAL `error` KernelStreamEvent (instead of `done`)
 * when the sensor faults mid-turn, so a truncated turn is never presented as
 * complete. The jarvis /stream consumer's for-await loop switched on
 * turn_start / text_delta / gate_verdict / confidence / self_model / done — but
 * NOT `error`. An `error` frame fell through the loop with NO terminal frame,
 * leaving the client with a SILENTLY truncated stream (no `done`, no `error`).
 *
 * These tests pin the fix: a mid-stream `error` frame produces a client-visible
 * `error` SSE event (generic banner — no raw reason on the wire) followed by a
 * terminal `done` frame, never a silent truncation.
 *
 * RED before the fix: the stream ended after the last `text_delta` with no
 * `error` and no `done` event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// The kernel stream is driven per-case: `mode` selects whether thinkStream
// terminates with a mid-stream `error` frame or a clean `done`.
let mode: 'error' | 'clean' = 'error';

vi.mock('../../composition/sovereign', () => ({
  getSovereignBrain: async () => ({
    kernel: {
      async *thinkStream() {
        yield { kind: 'turn_start' };
        yield { kind: 'text_delta', text: 'partial answer before the fault' };
        if (mode === 'error') {
          // TERMINAL error frame — no `done` follows (mirrors kernel D19).
          yield { kind: 'error', reason: 'PROVIDER_TIMEOUT', partial: true };
          return;
        }
        yield {
          kind: 'done',
          decision: {
            kind: 'answer',
            text: 'partial answer before the fault',
            provenance: { thoughtId: 'tho_stream_ok', latencyMs: 1 },
          },
        };
      },
    },
  }),
}));

// Keep egress / ingress inert so the test isolates the error-frame handling.
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
// Grounding auditor inert — never withholds / warns here (focus: error frame).
vi.mock('../jarvis-grounding.js', () => ({
  auditAndEnforceThinkResponse: async () => ({ withheld: false, audit: null }),
  emitAuditorFrameStream: async () => undefined,
  pickAuditLang: () => 'en',
}));

import { createJarvisRouter } from '../jarvis-router-factory';
import { GENERIC_STREAM_ERROR_FOR_TEST } from '../jarvis-router-factory';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

const TENANT_BEARER = `Bearer ${generateToken({
  userId: 'usr-test',
  tenantId: 'tnt-test',
  role: UserRole.OWNER as never,
  permissions: ['*'],
  propertyAccess: ['*'],
})}`;

function mount(): Hono {
  const app = new Hono();
  app.route(
    '/jarvis',
    createJarvisRouter({ surface: 'owner-portal', defaultTier: 'portfolio' }),
  );
  return app;
}

async function collectSse(
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

async function stream(app: Hono) {
  return app.request('/jarvis/stream', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: TENANT_BEARER,
    },
    body: JSON.stringify({ threadId: 'thr-1', userMessage: 'hello' }),
  });
}

beforeEach(() => {
  mode = 'error';
});

describe('jarvis /stream — terminal kernel error frame (no silent truncation)', () => {
  it('emits a client-visible error frame + terminal done on a mid-stream error', async () => {
    mode = 'error';
    const res = await stream(mount());
    expect(res.status).toBe(200);
    const { types, frames } = await collectSse(res.body);

    // The client MUST see a terminal error frame — not a silent truncation.
    expect(types).toContain('error');
    // And an honest terminal `done` (kind: error) so the client closes cleanly.
    expect(types).toContain('done');

    // Generic banner only — the raw kernel reason never reaches the wire.
    expect(frames.error).toBeDefined();
    expect(frames.error).toContain(GENERIC_STREAM_ERROR_FOR_TEST);
    expect(frames.error).not.toContain('PROVIDER_TIMEOUT');
    expect(JSON.parse(frames.done).kind).toBe('error');

    // The partial delta was still streamed before the fault (honest partial).
    expect(types).toContain('delta');
  });

  it('does NOT emit an error frame on a clean stream', async () => {
    mode = 'clean';
    const res = await stream(mount());
    expect(res.status).toBe(200);
    const { types, frames } = await collectSse(res.body);

    expect(types).not.toContain('error');
    expect(types).toContain('done');
    expect(JSON.parse(frames.done).kind).toBe('answer');
  });
});
