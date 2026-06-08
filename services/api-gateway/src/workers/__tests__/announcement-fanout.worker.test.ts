/**
 * Announcement fan-out worker — unit test for tickOnce.
 *
 * Verifies the broadcast email/SMS fan-out contract:
 *   1. A claimed `email`/`both` announcement enqueues N `pending`
 *      notification_dispatch_log rows with the correct per-recipient
 *      idempotency keys (`announcement::<id>::<userId>::<channel>`).
 *   2. A second tick does NOT re-claim / re-enqueue the same announcement
 *      (the `fanned_out_at` claim marker means the claim query returns []),
 *      and the worker never double-inserts.
 *   3. An announcement with ZERO eligible recipients inserts nothing.
 *
 * The DB is stubbed; only the SQL shape (UPDATE-claim / INSERT) + the bound
 * values are exercised. Real integration is covered by the deployed worker
 * hitting the live platform_announcements + notification_dispatch_log tables.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createAnnouncementFanoutWorker,
  buildIdempotencyKey,
  channelsForRecipient,
  type BroadcastRecipient,
  type RecipientResolverPort,
} from '../announcement-fanout.worker.js';

interface Captured {
  readonly sql: string;
  readonly values: unknown[];
}

/**
 * Flatten a Drizzle `SQL` object into static text + bound values.
 *
 * Drizzle stores its query as `queryChunks`: an interleaving of `StringChunk`
 * objects (whose `.value` is a `string[]` of static SQL) and the embedded
 * parameter VALUES themselves, which appear as raw chunks (e.g. the string
 * 'ndl_abc' is a chunk directly — there is no flat `.values` array). We rebuild
 * the static text from the StringChunks and collect every non-StringChunk as a
 * bound value.
 */
function flattenSql(q: unknown): { text: string; values: unknown[] } {
  const chunks = (q as { queryChunks?: ReadonlyArray<unknown> })?.queryChunks ?? [];
  const textParts: string[] = [];
  const values: unknown[] = [];
  for (const chunk of chunks) {
    const sc = chunk as { value?: unknown };
    if (sc && typeof sc === 'object' && Array.isArray(sc.value)) {
      textParts.push((sc.value as string[]).join(''));
    } else {
      values.push(chunk);
    }
  }
  return { text: textParts.join(' '), values };
}

/**
 * Stub DB that captures every query's flattened SQL text + bound values.
 * `claimRows` is returned ONLY on the first UPDATE-claim against
 * platform_announcements; every later call (and every INSERT) returns [].
 */
function makeStubDb(claimRows: ReadonlyArray<Record<string, unknown>>) {
  const calls: Captured[] = [];
  let claimReturned = false;
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const { text, values } = flattenSql(q);
      calls.push({ sql: text, values });
      if (
        text.includes('UPDATE platform_announcements') &&
        text.includes('RETURNING') &&
        !claimReturned
      ) {
        claimReturned = true;
        return { rows: claimRows };
      }
      return { rows: [] };
    }),
  };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as any;

/** A resolver that always returns the supplied recipients. */
function staticResolver(
  recipients: readonly BroadcastRecipient[],
): RecipientResolverPort {
  return { resolve: vi.fn(async () => recipients) };
}

const emailRecipient = (
  overrides: Partial<BroadcastRecipient> = {},
): BroadcastRecipient => ({
  tenantId: 't-1',
  userId: 'u-1',
  email: 'owner@example.com',
  phone: null,
  preferredChannel: 'email',
  locale: 'en',
  ...overrides,
});

/** Pull the bound idempotency_key values out of every INSERT call. */
function insertedIdempotencyKeys(calls: readonly Captured[]): string[] {
  return calls
    .filter((c) => c.sql.includes('INSERT INTO notification_dispatch_log'))
    .flatMap((c) =>
      c.values.filter(
        (v): v is string =>
          typeof v === 'string' && v.startsWith('announcement::'),
      ),
    );
}

describe('announcement-fanout worker', () => {
  it('enqueues one pending dispatch-log row per (recipient, channel) with the right idempotency keys', async () => {
    const db = makeStubDb([
      {
        id: 'ann-1',
        scope: 'tenant:t-1',
        channel: 'both',
        subject: 'Royalty window closing',
        body: 'Submit returns by Friday.',
      },
    ]);
    const recipients = [
      emailRecipient({ userId: 'u-1', email: 'a@example.com', phone: '+255700000001' }),
      emailRecipient({ userId: 'u-2', email: 'b@example.com', phone: null }),
    ];
    const worker = createAnnouncementFanoutWorker({
      db,
      logger: stubLogger,
      resolveRecipients: staticResolver(recipients),
      enabled: true,
    });

    const res = await worker.tickOnce();

    expect(res.claimed).toBe(1);
    // u-1 → email + sms (has phone); u-2 → email only (no phone) = 3 rows.
    expect(res.enqueued).toBe(3);
    expect(res.skippedNoRecipients).toBe(0);

    const keys = insertedIdempotencyKeys(db.calls);
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(
      expect.arrayContaining([
        buildIdempotencyKey('ann-1', 'u-1', 'email'),
        buildIdempotencyKey('ann-1', 'u-1', 'sms'),
        buildIdempotencyKey('ann-1', 'u-2', 'email'),
      ]),
    );
    // Every enqueue is an idempotent upsert.
    const inserts = db.calls.filter((c) =>
      c.sql.includes('INSERT INTO notification_dispatch_log'),
    );
    expect(inserts).toHaveLength(3);
    for (const ins of inserts) {
      expect(ins.sql).toContain('ON CONFLICT (tenant_id, idempotency_key) DO NOTHING');
      expect(ins.sql).toContain("'pending'");
    }
  });

  it('claims via fanned_out_at and does NOT re-enqueue on a second tick (idempotent)', async () => {
    const db = makeStubDb([
      {
        id: 'ann-2',
        scope: 'tenant:t-1',
        channel: 'email',
        subject: 'Shift change',
        body: 'New roster live.',
      },
    ]);
    const worker = createAnnouncementFanoutWorker({
      db,
      logger: stubLogger,
      resolveRecipients: staticResolver([emailRecipient()]),
      enabled: true,
    });

    const first = await worker.tickOnce();
    expect(first.claimed).toBe(1);
    expect(first.enqueued).toBe(1);
    const insertsAfterFirst = db.calls.filter((c) =>
      c.sql.includes('INSERT INTO notification_dispatch_log'),
    ).length;
    expect(insertsAfterFirst).toBe(1);

    // The claim query stamps fanned_out_at; the stub returns no rows on the
    // second claim — modelling the row no longer being claimable.
    const second = await worker.tickOnce();
    expect(second.claimed).toBe(0);
    expect(second.enqueued).toBe(0);
    const insertsAfterSecond = db.calls.filter((c) =>
      c.sql.includes('INSERT INTO notification_dispatch_log'),
    ).length;
    // No NEW inserts were issued on the second tick.
    expect(insertsAfterSecond).toBe(insertsAfterFirst);

    // The claim query is the right shape: it filters un-fanned-out + stamps it.
    const claimCall = db.calls.find((c) =>
      c.sql.includes('UPDATE platform_announcements'),
    );
    expect(claimCall).toBeDefined();
    expect(claimCall!.sql).toContain('fanned_out_at IS NULL');
    expect(claimCall!.sql).toContain('SET fanned_out_at');
    expect(claimCall!.sql).toContain("channel IN ('email', 'both')");
  });

  it('enqueues nothing when the announcement has zero eligible recipients', async () => {
    const db = makeStubDb([
      {
        id: 'ann-3',
        scope: 'global',
        channel: 'both',
        subject: 'System notice',
        body: 'Maintenance tonight.',
      },
    ]);
    const worker = createAnnouncementFanoutWorker({
      db,
      logger: stubLogger,
      resolveRecipients: staticResolver([]),
      enabled: true,
    });

    const res = await worker.tickOnce();

    expect(res.claimed).toBe(1);
    expect(res.enqueued).toBe(0);
    expect(res.skippedNoRecipients).toBe(1);
    const inserts = db.calls.filter((c) =>
      c.sql.includes('INSERT INTO notification_dispatch_log'),
    );
    expect(inserts).toHaveLength(0);
  });

  it('drops recipients with no usable address (no email AND no phone)', async () => {
    const db = makeStubDb([
      {
        id: 'ann-4',
        scope: 'tenant:t-1',
        channel: 'both',
        subject: 'X',
        body: 'Y',
      },
    ]);
    const worker = createAnnouncementFanoutWorker({
      db,
      logger: stubLogger,
      resolveRecipients: staticResolver([
        emailRecipient({ userId: 'u-9', email: null, phone: null }),
      ]),
      enabled: true,
    });

    const res = await worker.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.enqueued).toBe(0);
    // The recipient was unusable, so it counts as "no eligible recipients".
    expect(res.skippedNoRecipients).toBe(1);
  });

  it('returns zeroes when no announcements are due', async () => {
    const db = makeStubDb([]);
    const worker = createAnnouncementFanoutWorker({
      db,
      logger: stubLogger,
      resolveRecipients: staticResolver([emailRecipient()]),
      enabled: true,
    });
    const res = await worker.tickOnce();
    expect(res).toEqual({ claimed: 0, enqueued: 0, skippedNoRecipients: 0 });
  });
});

describe('channelsForRecipient (pure)', () => {
  it('email announcement → email only', () => {
    expect(
      channelsForRecipient('email', emailRecipient({ phone: '+255700000000' })),
    ).toEqual(['email']);
  });
  it('both announcement → email + sms when both addresses exist', () => {
    expect(
      channelsForRecipient('both', emailRecipient({ phone: '+255700000000' })),
    ).toEqual(['email', 'sms']);
  });
  it('both announcement → email only when no phone', () => {
    expect(channelsForRecipient('both', emailRecipient({ phone: null }))).toEqual([
      'email',
    ]);
  });
  it('email announcement → [] when no email', () => {
    expect(channelsForRecipient('email', emailRecipient({ email: null }))).toEqual(
      [],
    );
  });
});
