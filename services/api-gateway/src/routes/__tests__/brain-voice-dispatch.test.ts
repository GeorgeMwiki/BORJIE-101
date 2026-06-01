/**
 * brain-voice — SAFE verbal-confirmation dispatch coverage.
 *
 * `dispatchVoiceToolCall` is the seam that makes the realtime voice channel
 * action-capable WITHOUT letting a spoken phrase silently mutate durable
 * records or move money. This suite pins the safety contract:
 *
 *   (1) AUTO-SAFE verb (reminder) → gate runs, then EXECUTES on first mention.
 *   (2) CONFIRM-REQUIRED verb (create_site) → returns a single-use token and
 *       does NOT execute (the executor is never called).
 *   (3) confirm_pending_action with a VALID token → executes the originally
 *       proposed verb (the spoken-"yes" round-trip).
 *   (4) confirm_pending_action with an EXPIRED token → rejected, no execute.
 *   (5) confirm_pending_action with a TENANT-MISMATCHED token → rejected.
 *   (6) confirm_pending_action with an ALREADY-USED token → rejected
 *       (single-use).
 *   (7) gate DENY (auto-safe path) → no execute.
 *   (8) gate DENY on the confirmed path → token consumed, no execute.
 *
 * The action-executor membership predicates (`isSafeVerb`/`requiresConfirmation`)
 * are mocked so the dispatch's OWN routing — not the registry internals — is
 * what's under test. The gate + executor + db are injected via `deps` so no
 * Postgres / kernel is touched; the GUC bind is asserted on the injected tx.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BrainAuthPrincipal } from '@borjie/ai-copilot';

// Mock ONLY the executor membership predicates so we can drive each routing
// branch. `dispatchAction` is also stubbed here but the tests inject their own
// spy via `deps.dispatch` for precise call assertions.
vi.mock('../../services/action-executor/index.js', () => ({
  isSafeVerb: vi.fn((verb: string) => verb === 'set_reminder'),
  requiresConfirmation: vi.fn((verb: string) =>
    ['create_site', 'draft_payroll_run'].includes(verb),
  ),
  dispatchAction: vi.fn(async () => ({ executed: false, reason: 'unmocked' })),
}));

import {
  dispatchVoiceToolCall,
  mintConfirmationToken,
  consumeConfirmationToken,
  CONFIRM_PENDING_ACTION_TOOL,
  CONFIRMATION_TTL_MS,
  __resetConfirmationStoreForTests,
} from '../brain-voice.hono.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const TENANT = 'tenant-aurum';
const OTHER_TENANT = 'tenant-stranger';

const principal: BrainAuthPrincipal = {
  userId: 'user-1',
  tenantId: TENANT,
  environment: 'production',
  roles: ['owner'],
  teamIds: [],
  raw: {},
};

/** An injected tx whose `execute` records the SET LOCAL GUC bind SQL. */
function makeDbStub() {
  const executed: unknown[] = [];
  const tx = {
    execute: vi.fn(async (q: unknown) => {
      executed.push(q);
      return undefined;
    }),
  };
  const db = {
    transaction: vi.fn(async <T>(fn: (t: unknown) => Promise<T>) => fn(tx)),
  };
  return { db, tx, executed };
}

const ALLOW = vi.fn(() => ({ authorized: true, reason: 'authorized' }));
const DENY = vi.fn(() => ({ authorized: false, reason: 'policy-gate:blocked' }));

beforeEach(() => {
  __resetConfirmationStoreForTests();
  vi.clearAllMocks();
});

// ─── Token store primitives ──────────────────────────────────────────

describe('confirmation token store', () => {
  it('mints, then consumes a token exactly once (single-use)', () => {
    const now = 1_000_000;
    const { token, expiresAt } = mintConfirmationToken(
      { tenantId: TENANT, userId: 'u', verb: 'create_site', params: { name: 'Pit 7' } },
      { now, newToken: () => 'tok-1' },
    );
    expect(token).toBe('tok-1');
    expect(expiresAt).toBe(now + CONFIRMATION_TTL_MS);

    const first = consumeConfirmationToken(token, { tenantId: TENANT, userId: 'u', now: now + 1 });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.pending.verb).toBe('create_site');

    // Second consume must fail — the token is gone.
    const second = consumeConfirmationToken(token, { tenantId: TENANT, userId: 'u', now: now + 2 });
    expect(second).toEqual({ ok: false, reason: 'unknown_token' });
  });

  it('rejects an expired token and a tenant mismatch (and burns it)', () => {
    const now = 5_000;
    mintConfirmationToken(
      { tenantId: TENANT, userId: 'u', verb: 'create_site', params: {} },
      { now, ttlMs: 100, newToken: () => 'tok-exp' },
    );
    const expired = consumeConfirmationToken('tok-exp', {
      tenantId: TENANT,
      userId: 'u',
      now: now + 101,
    });
    expect(expired).toEqual({ ok: false, reason: 'expired_token' });

    mintConfirmationToken(
      { tenantId: TENANT, userId: 'u', verb: 'create_site', params: {} },
      { now, newToken: () => 'tok-mismatch' },
    );
    const mismatch = consumeConfirmationToken('tok-mismatch', {
      tenantId: OTHER_TENANT,
      userId: 'u',
      now: now + 1,
    });
    expect(mismatch).toEqual({ ok: false, reason: 'tenant_mismatch' });
    // The mismatched token is burned — a retry under the right tenant fails.
    const retry = consumeConfirmationToken('tok-mismatch', {
      tenantId: TENANT,
      userId: 'u',
      now: now + 2,
    });
    expect(retry).toEqual({ ok: false, reason: 'unknown_token' });
  });

  it('rejects a USER mismatch within the same tenant (and burns it)', () => {
    const now = 7_000;
    mintConfirmationToken(
      { tenantId: TENANT, userId: 'user-a', verb: 'create_site', params: {} },
      { now, newToken: () => 'tok-user' },
    );
    // Same tenant, DIFFERENT user — a token proposed in A's session can never
    // be completed by B (propose-by-A / confirm-by-B is forbidden).
    const mismatch = consumeConfirmationToken('tok-user', {
      tenantId: TENANT,
      userId: 'user-b',
      now: now + 1,
    });
    expect(mismatch).toEqual({ ok: false, reason: 'user_mismatch' });
    // Burned even on mismatch — the original user cannot retry it either.
    const retry = consumeConfirmationToken('tok-user', {
      tenantId: TENANT,
      userId: 'user-a',
      now: now + 2,
    });
    expect(retry).toEqual({ ok: false, reason: 'unknown_token' });
  });
});

// ─── (1) AUTO-SAFE executes ──────────────────────────────────────────

describe('dispatchVoiceToolCall — auto-safe verb', () => {
  it('gates then EXECUTES a reminder on first mention, binding the tenant GUC', async () => {
    const { db, tx, executed } = makeDbStub();
    const dispatch = vi.fn(async () => ({
      executed: true,
      result: { kind: 'reminder', id: 'r1', summary: 'Reminder set' },
    }));

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: 'set_reminder', args: { text: 'call assayer', at: 'tomorrow' } },
      deps: { db, dispatch, decideAuthorization: ALLOW as never },
    });

    expect(ALLOW).toHaveBeenCalledOnce();
    expect(db.transaction).toHaveBeenCalledOnce();
    // GUC was bound transaction-locally BEFORE dispatch.
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(executed).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(
      'set_reminder',
      { text: 'call assayer', at: 'tomorrow' },
      expect.objectContaining({ tenantId: TENANT, userId: 'user-1' }),
    );
    expect(out).toMatchObject({ status: 'executed', executed: true, tool: 'set_reminder' });
  });

  it('does NOT execute when the gate DENIES an auto-safe verb', async () => {
    const { db } = makeDbStub();
    const dispatch = vi.fn();

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: 'set_reminder', args: {} },
      deps: { db, dispatch, decideAuthorization: DENY as never },
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'denied', executed: false });
  });
});

// ─── (2) CONFIRM-REQUIRED mints a token, does NOT execute ────────────

describe('dispatchVoiceToolCall — confirm-required verb', () => {
  it('returns a single-use token and does NOT execute on first mention', async () => {
    const { db } = makeDbStub();
    const dispatch = vi.fn();

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: 'create_site', args: { name: 'Pit 9' } },
      deps: {
        db,
        dispatch,
        decideAuthorization: ALLOW as never,
        newToken: () => 'pending-1',
      },
    });

    // Crucially: NOTHING executed, the gate was not even consulted yet.
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(ALLOW).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      status: 'confirmation_required',
      executed: false,
      tool: 'create_site',
      confirmationToken: 'pending-1',
    });
    expect(typeof (out as { expiresAt?: unknown }).expiresAt).toBe('string');

    // The token is live in the store, bound to this tenant + verb.
    const peek = consumeConfirmationToken('pending-1', { tenantId: TENANT, userId: 'user-1' });
    expect(peek.ok).toBe(true);
    if (peek.ok) {
      expect(peek.pending.verb).toBe('create_site');
      expect(peek.pending.params).toEqual({ name: 'Pit 9' });
    }
  });
});

// ─── (3..8) confirm_pending_action round-trip ────────────────────────

describe('dispatchVoiceToolCall — confirm_pending_action', () => {
  async function propose(newToken: string) {
    const { db } = makeDbStub();
    await dispatchVoiceToolCall({
      principal,
      call: { name: 'create_site', args: { name: 'Pit 42' } },
      deps: { db, dispatch: vi.fn(), decideAuthorization: ALLOW as never, newToken: () => newToken },
    });
  }

  it('(3) executes the proposed verb when the token is VALID (spoken yes)', async () => {
    await propose('valid-tok');
    const { db, tx, executed } = makeDbStub();
    const dispatch = vi.fn(async () => ({
      executed: true,
      result: { kind: 'site', id: 's1', summary: 'Site created' },
    }));

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'valid-tok' } },
      deps: { db, dispatch, decideAuthorization: ALLOW as never },
    });

    // Gate ran on the confirmed path, GUC bound, then the ORIGINAL verb ran.
    expect(ALLOW).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(executed).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(
      'create_site',
      { name: 'Pit 42' },
      expect.objectContaining({ tenantId: TENANT }),
    );
    expect(out).toMatchObject({ status: 'executed', executed: true, tool: 'create_site' });
  });

  it('(4) rejects an EXPIRED token and does NOT execute', async () => {
    // Mint with a tiny TTL directly so we control expiry deterministically.
    mintConfirmationToken(
      { tenantId: TENANT, userId: 'user-1', verb: 'create_site', params: {} },
      { now: 0, ttlMs: 10, newToken: () => 'stale-tok' },
    );
    const { db } = makeDbStub();
    const dispatch = vi.fn();

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'stale-tok' } },
      deps: { db, dispatch, decideAuthorization: ALLOW as never, now: () => 999_999 },
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'rejected', executed: false, reason: 'expired_token' });
  });

  it('(5) rejects a TENANT-MISMATCHED token and does NOT execute', async () => {
    // Align the mint + consume clocks so the token is NOT expired — the
    // mismatch is what must reject it, not staleness.
    const t0 = 1_000_000;
    mintConfirmationToken(
      { tenantId: OTHER_TENANT, userId: 'x', verb: 'create_site', params: {} },
      { now: t0, newToken: () => 'foreign-tok' },
    );
    const { db } = makeDbStub();
    const dispatch = vi.fn();

    const out = await dispatchVoiceToolCall({
      principal, // TENANT, not OTHER_TENANT
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'foreign-tok' } },
      deps: { db, dispatch, decideAuthorization: ALLOW as never, now: () => t0 + 1 },
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'rejected', executed: false, reason: 'tenant_mismatch' });
  });

  it('(6) rejects an ALREADY-USED token (single-use) on a second spoken yes', async () => {
    await propose('once-tok');
    const dispatchOk = vi.fn(async () => ({
      executed: true,
      result: { kind: 'site', id: 's2', summary: 'ok' },
    }));
    // First confirm consumes it.
    await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'once-tok' } },
      deps: { db: makeDbStub().db, dispatch: dispatchOk, decideAuthorization: ALLOW as never },
    });

    // Second confirm with the same token must be rejected, nothing executes.
    const dispatch2 = vi.fn();
    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'once-tok' } },
      deps: { db: makeDbStub().db, dispatch: dispatch2, decideAuthorization: ALLOW as never },
    });

    expect(dispatch2).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'rejected', executed: false, reason: 'unknown_token' });
  });

  it('(7) rejects a missing token argument', async () => {
    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: {} },
      deps: { db: makeDbStub().db, dispatch: vi.fn(), decideAuthorization: ALLOW as never },
    });
    expect(out).toMatchObject({ status: 'rejected', executed: false, reason: 'missing_token' });
  });

  it('(8) gate DENY on the confirmed path consumes the token but does NOT execute', async () => {
    await propose('deny-tok');
    const { db } = makeDbStub();
    const dispatch = vi.fn();

    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: CONFIRM_PENDING_ACTION_TOOL, args: { token: 'deny-tok' } },
      deps: { db, dispatch, decideAuthorization: DENY as never },
    });

    expect(DENY).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'denied', executed: false });

    // Token was consumed even though the gate denied — a retry finds nothing.
    const retry = consumeConfirmationToken('deny-tok', { tenantId: TENANT, userId: 'user-1' });
    expect(retry).toEqual({ ok: false, reason: 'unknown_token' });
  });
});

// ─── Unknown / read tools are acknowledged, not executed ─────────────

describe('dispatchVoiceToolCall — non-write verb', () => {
  it('acknowledges a read/brain-catalog verb without executing', async () => {
    const { db } = makeDbStub();
    const dispatch = vi.fn();
    const out = await dispatchVoiceToolCall({
      principal,
      call: { name: 'get_production_summary', args: { period: 'q1' } },
      deps: { db, dispatch, decideAuthorization: ALLOW as never },
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'acknowledged', executed: false });
  });
});
