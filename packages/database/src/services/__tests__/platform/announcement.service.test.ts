/**
 * Unit tests — createPlatformAnnouncementService.
 *
 * Coverage:
 *   - send() inserts the row, queued status when no dispatcher
 *   - send() dispatcher success path bumps status + recipient count
 *   - send() dispatcher failure leaves row queued (no rethrow)
 *   - send() recipient-resolver error degrades to recipientCount=0
 *   - recall() updates status + invokes dispatcher.retract
 *   - recall() refuses empty announcementId
 *   - recall() rethrows on DB error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlatformAnnouncementService } from '../../platform/announcement.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.announcements — send', () => {
  it('queues the row when no dispatcher supplied', async () => {
    const stub = makeStubDb();
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
    });
    const out = await svc.send({
      scope: 'global',
      channel: 'banner',
      subject: 'maint',
      body: 'down 10m',
      scheduleAt: null,
    });
    expect(out.status).toBe('queued');
    expect(out.recipientCount).toBe(0);
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.status).toBe('queued');
    expect(insert?.values?.createdBy).toBe('op1');
  });

  it('uses dispatcher recipientCount + status when supplied', async () => {
    const stub = makeStubDb();
    const dispatcher = {
      dispatch: vi.fn(async () => ({
        recipientCount: 42,
        status: 'sent' as const,
      })),
      retract: vi.fn(async () => undefined),
    };
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
      dispatcher,
      recipientResolver: { count: async () => 50 },
    });
    const out = await svc.send({
      scope: 'tenant:acme',
      channel: 'email',
      subject: 's',
      body: 'b',
      scheduleAt: null,
    });
    expect(out.recipientCount).toBe(42);
    expect(out.status).toBe('sent');
    expect(dispatcher.dispatch).toHaveBeenCalled();
  });

  it('leaves row queued when dispatcher throws (no rethrow)', async () => {
    const stub = makeStubDb();
    const dispatcher = {
      dispatch: vi.fn(async () => {
        throw new Error('bus down');
      }),
      retract: vi.fn(async () => undefined),
    };
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
      dispatcher,
    });
    const out = await svc.send({
      scope: 'global',
      channel: 'banner',
      subject: 's',
      body: 'b',
      scheduleAt: null,
    });
    expect(out.status).toBe('queued');
  });

  it('degrades recipientCount to 0 when resolver throws', async () => {
    const stub = makeStubDb();
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
      recipientResolver: {
        count: async () => {
          throw new Error('audience svc down');
        },
      },
    });
    const out = await svc.send({
      scope: 'global',
      channel: 'banner',
      subject: 's',
      body: 'b',
      scheduleAt: null,
    });
    expect(out.recipientCount).toBe(0);
  });

  it('rethrows when DB insert fails', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('uniq boom'));
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
    });
    await expect(
      svc.send({
        scope: 'global',
        channel: 'banner',
        subject: 's',
        body: 'b',
        scheduleAt: null,
      }),
    ).rejects.toThrow(/uniq boom/);
  });
});

describe('platform.announcements — recall', () => {
  it('updates status to retracted + invokes dispatcher.retract', async () => {
    const stub = makeStubDb();
    const dispatcher = {
      dispatch: vi.fn(),
      retract: vi.fn(async () => undefined),
    };
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
      dispatcher,
    });
    await svc.recall({ announcementId: 'ann-1', reason: 'oops' });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.status).toBe('retracted');
    expect(update?.set?.retractedReason).toBe('oops');
    expect(dispatcher.retract).toHaveBeenCalled();
  });

  it('refuses empty announcementId', async () => {
    const stub = makeStubDb();
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
    });
    await expect(
      svc.recall({ announcementId: '', reason: 'x' }),
    ).rejects.toThrow(/required/);
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
    });
    await expect(
      svc.recall({ announcementId: 'ann-1', reason: 'x' }),
    ).rejects.toThrow(/boom/);
  });

  it('swallows dispatcher.retract errors after DB update succeeds', async () => {
    const stub = makeStubDb();
    const dispatcher = {
      dispatch: vi.fn(),
      retract: vi.fn(async () => {
        throw new Error('bus down');
      }),
    };
    const svc = createPlatformAnnouncementService(stub.client, {
      resolveActor: () => 'op1',
      dispatcher,
    });
    await expect(
      svc.recall({ announcementId: 'ann-1', reason: 'x' }),
    ).resolves.toBeUndefined();
  });
});
