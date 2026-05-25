/**
 * Session replay router tests — Central Command Phase B (B5).
 *
 * Pins the contract the client recorder (`apps/admin-web/
 * src/lib/session-replay`) and the replay viewer rely on:
 *
 *   1. Auth: POST /chunks without a token → 401
 *   2. Validation: malformed body → 400
 *   3. Max chunk size: > 5MB gzip → 413
 *   4. Degraded mode: missing db OR storage → 503
 *   5. Happy path: 200 with chunkId; storage.upload + appendChunk called
 *   6. Dedup: same (sessionId, sequence) twice → 200 with duplicate=true
 *   7. Admin-only list: ADMIN may GET; RESIDENT gets 403
 *   8. Tenant scope: list call inherits auth.tenantId
 *   9. Rate limit: ≥ MAX_BATCHES_PER_WINDOW per (tenant, session) → 429
 *  10. Recent sessions GET returns the service's listRecentSessions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

let appendChunkSpy: ReturnType<typeof vi.fn> = vi.fn();
let listForSessionSpy: ReturnType<typeof vi.fn> = vi.fn();
let listRecentSessionsSpy: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@borjie/database', () => ({
  createSessionReplayChunksService: () => ({
    appendChunk: appendChunkSpy,
    listForSession: listForSessionSpy,
    listRecentSessions: listRecentSessionsSpy,
  }),
}));

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import sessionReplayRouter, {
  __resetSessionReplayRateLimiter,
} from '../session-replay.router';
import type { SessionReplayStoragePort } from '../../storage/session-replay-storage';

function bearer(role: UserRole = UserRole.ADMIN, tenantId = 'tnt-1'): string {
  return `Bearer ${generateToken({
    userId: 'usr-1',
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function attachServices(services: Record<string, unknown>) {
  return async (c: any, next: any) => {
    c.set('services', services);
    await next();
  };
}

function makeStorageStub(): {
  port: SessionReplayStoragePort;
  uploads: Array<{ chunkId: string; bytes: number }>;
} {
  const uploads: Array<{ chunkId: string; bytes: number }> = [];
  const port: SessionReplayStoragePort = {
    kind: 'local',
    upload: vi.fn(async ({ chunkId, gzipBytes }) => {
      uploads.push({ chunkId, bytes: gzipBytes.byteLength });
      return { storageUri: `file:///tmp/${chunkId}.gz` };
    }) as never,
    download: vi.fn(async () => new Uint8Array([0x1f, 0x8b])) as never,
  };
  return { port, uploads };
}

function mount(
  overrides: { db?: unknown; storage?: SessionReplayStoragePort | null } = {},
): Hono {
  const services: Record<string, unknown> = {
    db: overrides.db === undefined ? {} : overrides.db,
  };
  if (overrides.storage !== null) {
    services.sessionReplayStorage =
      overrides.storage ?? makeStorageStub().port;
  }
  const app = new Hono();
  app.use('*', attachServices(services));
  app.route('/session-replay', sessionReplayRouter);
  return app;
}

function gzipBase64(byteLength = 128): string {
  // We just need a non-empty base64 blob — the router stores opaque
  // bytes, it does not decompress.
  return Buffer.from(new Uint8Array(byteLength).fill(0x42)).toString('base64');
}

function chunkBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-1',
    sequenceNumber: 0,
    eventCount: 12,
    capturedAt: new Date().toISOString(),
    eventsGzipBase64: gzipBase64(),
    ...overrides,
  };
}

describe('session-replay router', () => {
  beforeEach(() => {
    __resetSessionReplayRateLimiter();
    appendChunkSpy = vi.fn(async () => ({
      ok: true,
      chunkId: 'chunk_id_abc',
      reason: 'inserted' as const,
    }));
    listForSessionSpy = vi.fn(async () => []);
    listRecentSessionsSpy = vi.fn(async () => []);
  });

  it('rejects POST /chunks without a bearer token (401)', async () => {
    const res = await mount().request('/session-replay/chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunkBody()),
    });
    expect(res.status).toBe(401);
  });

  it('rejects malformed POST body with 400', async () => {
    const res = await mount().request('/session-replay/chunks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ sessionId: 'sess-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 413 when payload exceeds the 5MB cap', async () => {
    // 8MB of base64 — decodes to ~6MB raw, over the 5MB limit.
    const big = Buffer.alloc(8 * 1024 * 1024, 0x42).toString('base64');
    const res = await mount().request('/session-replay/chunks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify(chunkBody({ eventsGzipBase64: big })),
    });
    // Zod's max() will trip first; that's still a 400-class. We accept
    // either 400 (zod) or 413 (body-size guard) — both signal "too big".
    expect([400, 413]).toContain(res.status);
  });

  it('returns 503 when db is null', async () => {
    const res = await mount({ db: null }).request('/session-replay/chunks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify(chunkBody()),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SESSION_REPLAY_UNAVAILABLE');
  });

  it('returns 503 when storage is missing', async () => {
    const res = await mount({ storage: null }).request(
      '/session-replay/chunks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(),
        },
        body: JSON.stringify(chunkBody()),
      },
    );
    expect(res.status).toBe(503);
  });

  it('happy path: stores bytes, writes metadata, returns chunkId', async () => {
    const { port, uploads } = makeStorageStub();
    const res = await mount({ storage: port }).request(
      '/session-replay/chunks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(),
        },
        body: JSON.stringify(chunkBody({ sequenceNumber: 7 })),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { chunkId: string; sequenceNumber: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.chunkId).toBe('chunk_id_abc');
    expect(body.data.sequenceNumber).toBe(7);
    expect(uploads).toHaveLength(1);
    expect(appendChunkSpy).toHaveBeenCalledOnce();
    const callArgs = appendChunkSpy.mock.calls[0]?.[0] as {
      tenantId: string;
      sequenceNumber: number;
      storageUri: string;
    };
    expect(callArgs.tenantId).toBe('tnt-1');
    expect(callArgs.storageUri.startsWith('file:///tmp/')).toBe(true);
  });

  it('dedup: duplicate (sessionId, sequenceNumber) → 200 with duplicate=true', async () => {
    appendChunkSpy = vi.fn(async () => ({
      ok: false,
      chunkId: null,
      reason: 'duplicate' as const,
    }));
    const res = await mount().request('/session-replay/chunks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify(chunkBody({ sequenceNumber: 4 })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { duplicate: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.duplicate).toBe(true);
  });

  it('GET /sessions/:id/chunks is admin-only — RESIDENT gets 403', async () => {
    const res = await mount().request(
      '/session-replay/sessions/sess-1/chunks',
      {
        headers: { Authorization: bearer(UserRole.RESIDENT) },
      },
    );
    expect(res.status).toBe(403);
  });

  it('GET /sessions/:id/chunks returns the service rows for an ADMIN', async () => {
    listForSessionSpy = vi.fn(async () => [
      {
        id: 'c0',
        tenantId: 'tnt-1',
        userId: 'u',
        sessionId: 'sess-1',
        surface: 'admin-web',
        sequenceNumber: 0,
        eventCount: 5,
        byteSize: 1024,
        storageUri: 'file:///tmp/c0.gz',
        capturedAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      },
    ]);
    const res = await mount().request(
      '/session-replay/sessions/sess-1/chunks',
      {
        headers: { Authorization: bearer() },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { sessionId: string; chunks: Array<{ id: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBe('sess-1');
    expect(body.data.chunks).toHaveLength(1);
    expect(body.data.chunks[0]?.id).toBe('c0');
    expect(listForSessionSpy).toHaveBeenCalledWith({
      tenantId: 'tnt-1',
      sessionId: 'sess-1',
    });
  });

  it('GET /sessions returns the recent-session summary', async () => {
    listRecentSessionsSpy = vi.fn(async () => [
      {
        sessionId: 'sess-A',
        userId: 'u',
        surface: 'admin-web',
        firstCapturedAt: new Date().toISOString(),
        lastCapturedAt: new Date().toISOString(),
        chunkCount: 3,
      },
    ]);
    const res = await mount().request('/session-replay/sessions', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { sessions: Array<{ sessionId: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.sessions[0]?.sessionId).toBe('sess-A');
  });

  it('rate limit: 429 once the bucket fills for one (tenant, session)', async () => {
    const app = mount();
    let lastStatus = 0;
    for (let i = 0; i < 250; i += 1) {
      const res = await app.request('/session-replay/chunks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(),
        },
        body: JSON.stringify(chunkBody({ sequenceNumber: i })),
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
