/**
 * Unit tests — createPlatformUsersService.
 *
 * Coverage:
 *   - listUsers happy path + role mapping from preferences.role
 *   - listUsers falls back to isOwner → owner role
 *   - listUsers cursor + nextCursor when hasMore
 *   - listUsers returns empty result on DB error
 *   - tenantExists / emailExistsOnTenant true / false / DB-error
 *   - createUser happy path with sendInvite=true → status invited
 *   - createUser happy path with sendInvite=false → status active
 *   - createUser rethrows on DB error
 *   - deactivateUser updates status + rethrows on error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPlatformUsersService } from '../../platform/users.platform.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.users — listUsers', () => {
  it('maps preferences.role onto HQ role enum', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        id: 'u1',
        tenantId: 't1',
        email: 'a@b.test',
        status: 'active',
        isOwner: false,
        lastLoginAt: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        preferences: { role: 'manager' },
      },
    ]);
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.listUsers({
      tenantId: 't1',
      role: null,
      limit: 25,
      cursor: null,
    });
    expect(out.rows[0]?.role).toBe('manager');
    expect(out.rows[0]?.status).toBe('active');
  });

  it('falls back to owner when isOwner=true and no preferences.role', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        id: 'u2',
        tenantId: 't1',
        email: 'o@b.test',
        status: 'active',
        isOwner: true,
        lastLoginAt: null,
        createdAt: new Date(),
        preferences: {},
      },
    ]);
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.listUsers({
      tenantId: null,
      role: null,
      limit: 10,
      cursor: null,
    });
    expect(out.rows[0]?.role).toBe('owner');
  });

  it('emits nextCursor when more pages exist', async () => {
    const stub = makeStubDb();
    const rows = Array.from({ length: 6 }).map((_, i) => ({
      id: `u${i}`,
      tenantId: 't1',
      email: `${i}@b.test`,
      status: 'active',
      isOwner: false,
      lastLoginAt: null,
      createdAt: new Date(`2026-05-0${i + 1}T00:00:00Z`),
      preferences: {},
    }));
    stub.setSelectRows(rows);
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.listUsers({
      tenantId: null,
      role: null,
      limit: 5,
      cursor: null,
    });
    expect(out.rows).toHaveLength(5);
    expect(out.nextCursor).not.toBeNull();
  });

  it('returns empty result on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.listUsers({
      tenantId: null,
      role: null,
      limit: 10,
      cursor: null,
    });
    expect(out.rows).toEqual([]);
  });
});

describe('platform.users — tenantExists / emailExistsOnTenant', () => {
  it('tenantExists true on hit, false on miss', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([{ id: 't1' }]);
    const svc = createPlatformUsersService(stub.client);
    expect(await svc.tenantExists('t1')).toBe(true);
    stub.setSelectRows([]);
    expect(await svc.tenantExists('missing')).toBe(false);
  });

  it('tenantExists returns false on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformUsersService(stub.client);
    expect(await svc.tenantExists('t1')).toBe(false);
  });

  it('emailExistsOnTenant rejects empty input safely', async () => {
    const stub = makeStubDb();
    const svc = createPlatformUsersService(stub.client);
    expect(
      await svc.emailExistsOnTenant({ tenantId: '', email: 'a@b.test' }),
    ).toBe(false);
    expect(
      await svc.emailExistsOnTenant({ tenantId: 't1', email: '' }),
    ).toBe(false);
  });
});

describe('platform.users — createUser', () => {
  it('creates an INVITED user when sendInvite=true', async () => {
    const stub = makeStubDb();
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.createUser({
      tenantId: 't1',
      email: 'new@acme.test',
      role: 'manager',
      sendInvite: true,
      displayName: null,
    });
    expect(out.status).toBe('invited');
    expect(out.invitedAt).not.toBeNull();
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.status).toBe('pending_activation');
    expect(insert?.values?.preferences).toEqual({ role: 'manager' });
  });

  it('creates an ACTIVE user when sendInvite=false and stamps isOwner for owner role', async () => {
    const stub = makeStubDb();
    const svc = createPlatformUsersService(stub.client);
    const out = await svc.createUser({
      tenantId: 't1',
      email: 'owner@acme.test',
      role: 'owner',
      sendInvite: false,
      displayName: 'Acme Owner',
    });
    expect(out.status).toBe('active');
    expect(out.invitedAt).toBeNull();
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.isOwner).toBe(true);
    expect(insert?.values?.activatedAt).toBeInstanceOf(Date);
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('uniq violation'));
    const svc = createPlatformUsersService(stub.client);
    await expect(
      svc.createUser({
        tenantId: 't1',
        email: 'x@y.test',
        role: 'manager',
        sendInvite: true,
        displayName: null,
      }),
    ).rejects.toThrow(/uniq violation/);
  });
});

describe('platform.users — deactivateUser', () => {
  it('updates status to deactivated', async () => {
    const stub = makeStubDb();
    const svc = createPlatformUsersService(stub.client);
    await svc.deactivateUser('u1');
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.status).toBe('deactivated');
    expect(update?.set?.invitationToken).toBeNull();
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformUsersService(stub.client);
    await expect(svc.deactivateUser('u1')).rejects.toThrow(/boom/);
  });

  it('refuses empty userId', async () => {
    const stub = makeStubDb();
    const svc = createPlatformUsersService(stub.client);
    await expect(svc.deactivateUser('')).rejects.toThrow(/required/);
  });
});
