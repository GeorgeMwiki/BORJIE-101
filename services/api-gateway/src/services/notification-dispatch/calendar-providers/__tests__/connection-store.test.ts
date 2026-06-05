/**
 * Calendar connection store — tenant+user-scoped reads/writes with tokens
 * ENCRYPTED at rest.
 *
 * The store talks to the DB through a single `execute(sql\`...\`)` seam. Tests
 * stub that seam with an in-memory fake that:
 *   - records the bound parameters of every query (so we can assert NO plaintext
 *     token is ever bound — only sealed blobs), and
 *   - returns scripted rows (so reads decrypt back to plaintext).
 *
 * Hard rules proven here:
 *   - tokens are sealed before they reach a column (never plaintext at rest),
 *   - every method binds tenant_id + user_id (scoping; RLS is the backstop),
 *   - getActive opens (decrypts) what a write sealed (round-trip through the DB
 *     boundary).
 *
 * No real network/DB: pure in-memory fake + the deterministic test cipher.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createCalendarConnectionStore,
  type DrizzleLike,
  type ActiveConnectionRow,
} from '../connection-store';
import {
  createCalendarTokenCipher,
  isSealedCalendarToken,
} from '../token-cipher';

const KEY = Buffer.alloc(32, 13).toString('base64');

/**
 * Extract the bound values of a drizzle `sql` template. Drizzle interleaves
 * literal `StringChunk`s (`.value: string[]`) with the raw interpolated JS
 * values; bound params are every chunk that is NOT a StringChunk. Recurses into
 * nested `sql` fragments (the store uses conditional `sql\`...\`` chunks).
 */
function boundParams(query: any): unknown[] {
  const out: unknown[] = [];
  const visit = (node: any): void => {
    if (node == null) return;
    if (
      typeof node === 'string' ||
      typeof node === 'number' ||
      typeof node === 'boolean' ||
      node instanceof Date
    ) {
      out.push(node);
      return;
    }
    if (Array.isArray(node.queryChunks)) {
      node.queryChunks.forEach(visit);
      return;
    }
    const ctor = node.constructor?.name;
    if (ctor === 'StringChunk') return;
    if (ctor === 'Param') {
      visit(node.value);
      return;
    }
    if (ctor === 'String' || ctor === 'Number' || ctor === 'Boolean') {
      out.push(node.valueOf());
      return;
    }
  };
  for (const chunk of query?.queryChunks ?? []) visit(chunk);
  return out;
}

function boundStrings(query: any): string[] {
  return boundParams(query).filter((p): p is string => typeof p === 'string');
}

interface RecordedCall {
  readonly params: unknown[];
  readonly strings: string[];
}

/**
 * In-memory DB seam. `script` supplies the rows for successive execute() calls
 * (FIFO); each call's bound params are recorded for assertions.
 */
function fakeDb(script: ReadonlyArray<{ rows: unknown[] }> = []) {
  const calls: RecordedCall[] = [];
  const queue = [...script];
  const db: DrizzleLike = {
    async execute(query: unknown) {
      calls.push({
        params: boundParams(query),
        strings: boundStrings(query),
      });
      return queue.shift() ?? { rows: [] };
    },
  };
  return { db, calls };
}

describe('CalendarConnectionStore.upsert — seals tokens, scopes by tenant+user', () => {
  it('binds sealed (non-plaintext) tokens and the tenant/user scope', async () => {
    const { db, calls } = fakeDb();
    const cipher = createCalendarTokenCipher(KEY);
    const store = createCalendarConnectionStore(db, cipher);

    await store.upsert({
      tenantId: 'tenant-1',
      userId: 'user-1',
      provider: 'google',
      refreshToken: 'PLAINTEXT-REFRESH',
      accessToken: 'PLAINTEXT-ACCESS',
      tokenExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
      calendarId: 'primary',
      scope: 'calendar',
    });

    // Two statements: soft-revoke prior active, then INSERT.
    expect(calls).toHaveLength(2);
    const insert = calls[1];

    // Plaintext NEVER appears in a bound parameter.
    expect(insert.strings).not.toContain('PLAINTEXT-REFRESH');
    expect(insert.strings).not.toContain('PLAINTEXT-ACCESS');

    // Sealed blobs ARE bound, and decrypt back to the originals.
    const sealed = insert.strings.filter(isSealedCalendarToken);
    expect(sealed).toHaveLength(2);
    const decrypted = sealed.map((b) => cipher.open(b));
    expect(decrypted).toContain('PLAINTEXT-REFRESH');
    expect(decrypted).toContain('PLAINTEXT-ACCESS');

    // Tenant + user scope is bound on BOTH the revoke and the insert.
    expect(calls[0].strings).toContain('tenant-1');
    expect(calls[0].strings).toContain('user-1');
    expect(insert.strings).toContain('tenant-1');
    expect(insert.strings).toContain('user-1');
    expect(insert.strings).toContain('google');
  });

  it('binds a null access token (no sealed access) when none is supplied', async () => {
    const { db, calls } = fakeDb();
    const cipher = createCalendarTokenCipher(KEY);
    const store = createCalendarConnectionStore(db, cipher);

    await store.upsert({
      tenantId: 'tenant-1',
      userId: 'user-1',
      provider: 'microsoft',
      refreshToken: 'only-refresh',
      accessToken: null,
      tokenExpiresAt: null,
      calendarId: 'primary',
      scope: null,
    });

    const insert = calls[1];
    const sealed = insert.strings.filter(isSealedCalendarToken);
    // Only the refresh token is sealed; the access column gets null.
    expect(sealed).toHaveLength(1);
    expect(cipher.open(sealed[0])).toBe('only-refresh');
  });

  it('returns a connection id prefixed cal_', async () => {
    const { db } = fakeDb();
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));
    const { id } = await store.upsert({
      tenantId: 't',
      userId: 'u',
      provider: 'google',
      refreshToken: 'r',
      accessToken: 'a',
      tokenExpiresAt: new Date(),
      calendarId: 'primary',
      scope: null,
    });
    expect(id).toMatch(/^cal_/);
  });
});

describe('CalendarConnectionStore.getActive — decrypts on read, scoped', () => {
  it('round-trips: a sealed column opens back to plaintext', async () => {
    const cipher = createCalendarTokenCipher(KEY);
    const sealedRefresh = cipher.seal('refresh-plain');
    const sealedAccess = cipher.seal('access-plain');

    const { db, calls } = fakeDb([
      {
        rows: [
          {
            id: 'cal_1',
            tenant_id: 'tenant-1',
            user_id: 'user-1',
            provider: 'google',
            encrypted_refresh_token: sealedRefresh,
            encrypted_access_token: sealedAccess,
            token_expires_at: '2026-06-01T00:00:00.000Z',
            calendar_id: 'primary',
            scope: 'calendar',
          },
        ],
      },
    ]);
    const store = createCalendarConnectionStore(db, cipher);

    const row = (await store.getActive(
      'tenant-1',
      'user-1',
      'google',
    )) as ActiveConnectionRow;

    expect(row).not.toBeNull();
    // The row carries SEALED blobs (never plaintext); opening them yields the
    // original tokens.
    expect(isSealedCalendarToken(row.encryptedRefreshToken)).toBe(true);
    expect(isSealedCalendarToken(row.encryptedAccessToken as string)).toBe(true);
    expect(cipher.open(row.encryptedRefreshToken)).toBe('refresh-plain');
    expect(cipher.open(row.encryptedAccessToken as string)).toBe('access-plain');

    // The read was scoped to tenant + user + provider.
    expect(calls[0].strings).toEqual(
      expect.arrayContaining(['tenant-1', 'user-1', 'google']),
    );
  });

  it('returns null when no active row exists', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));
    expect(await store.getActive('t', 'u', 'google')).toBeNull();
  });

  it('returns null for a malformed row (missing refresh token)', async () => {
    const { db } = fakeDb([
      { rows: [{ id: 'cal_1', tenant_id: 't', user_id: 'u', provider: 'google' }] },
    ]);
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));
    expect(await store.getActive('t', 'u', 'google')).toBeNull();
  });
});

describe('CalendarConnectionStore.updateTokens — re-seals on write', () => {
  it('binds a freshly sealed access token (never plaintext)', async () => {
    const { db, calls } = fakeDb();
    const cipher = createCalendarTokenCipher(KEY);
    const store = createCalendarConnectionStore(db, cipher);

    await store.updateTokens('cal_1', 'tenant-1', {
      accessToken: 'NEW-ACCESS-PLAIN',
      tokenExpiresAt: new Date('2026-06-02T00:00:00.000Z'),
    });

    const update = calls[0];
    expect(update.strings).not.toContain('NEW-ACCESS-PLAIN');
    const sealed = update.strings.filter(isSealedCalendarToken);
    expect(sealed).toHaveLength(1);
    expect(cipher.open(sealed[0])).toBe('NEW-ACCESS-PLAIN');
    // Scoped by id + tenant.
    expect(update.strings).toContain('cal_1');
    expect(update.strings).toContain('tenant-1');
  });

  it('also re-seals a rotated refresh token when supplied', async () => {
    const { db, calls } = fakeDb();
    const cipher = createCalendarTokenCipher(KEY);
    const store = createCalendarConnectionStore(db, cipher);

    await store.updateTokens('cal_1', 'tenant-1', {
      accessToken: 'A-PLAIN',
      refreshToken: 'ROTATED-REFRESH-PLAIN',
      tokenExpiresAt: new Date(),
    });

    const update = calls[0];
    expect(update.strings).not.toContain('A-PLAIN');
    expect(update.strings).not.toContain('ROTATED-REFRESH-PLAIN');
    const sealed = update.strings.filter(isSealedCalendarToken);
    // Both access + refresh sealed.
    expect(sealed).toHaveLength(2);
    const decrypted = sealed.map((b) => cipher.open(b));
    expect(decrypted).toContain('A-PLAIN');
    expect(decrypted).toContain('ROTATED-REFRESH-PLAIN');
  });
});

describe('CalendarConnectionStore.listStatus — token-free, scoped', () => {
  it('returns a token-free view and never binds or emits token columns', async () => {
    const { db, calls } = fakeDb([
      {
        rows: [
          {
            id: 'cal_1',
            provider: 'google',
            calendar_id: 'primary',
            scope: 'calendar',
            connected_at: '2026-05-01T00:00:00.000Z',
            token_expires_at: '2026-06-01T00:00:00.000Z',
          },
        ],
      },
    ]);
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));

    const views = await store.listStatus('tenant-1', 'user-1');

    expect(views).toHaveLength(1);
    const view = views[0] as Record<string, unknown>;
    // No token field is exposed on the status view.
    expect(view).not.toHaveProperty('encryptedRefreshToken');
    expect(view).not.toHaveProperty('encryptedAccessToken');
    expect(view).not.toHaveProperty('refreshToken');
    expect(view.id).toBe('cal_1');
    expect(view.provider).toBe('google');
    expect(view.connectedAt).toBe('2026-05-01T00:00:00.000Z');

    // Scoped to tenant + user.
    expect(calls[0].strings).toEqual(
      expect.arrayContaining(['tenant-1', 'user-1']),
    );
  });
});

describe('CalendarConnectionStore.disconnect — scoped soft-revoke', () => {
  it('binds tenant+user and returns the revoked row count', async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: 'cal_1' }, { id: 'cal_2' }] }]);
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));

    const revoked = await store.disconnect('tenant-1', 'user-1');
    expect(revoked).toBe(2);
    expect(calls[0].strings).toEqual(
      expect.arrayContaining(['tenant-1', 'user-1']),
    );
    // No provider filter bound when none is passed.
    expect(calls[0].strings).not.toContain('google');
  });

  it('binds the provider filter when a provider is given', async () => {
    const { db, calls } = fakeDb([{ rows: [{ id: 'cal_1' }] }]);
    const store = createCalendarConnectionStore(db, createCalendarTokenCipher(KEY));

    const revoked = await store.disconnect('tenant-1', 'user-1', 'microsoft');
    expect(revoked).toBe(1);
    expect(calls[0].strings).toContain('microsoft');
  });
});
