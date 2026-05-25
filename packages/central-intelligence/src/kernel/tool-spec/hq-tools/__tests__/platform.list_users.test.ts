import { describe, it, expect } from 'vitest';
import {
  createListUsersTool,
  type ListUsersOutput,
  type UsersServicePort,
} from '../platform.list_users.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

const SEED: ListUsersOutput['rows'] = [
  {
    userId: 'u-1',
    tenantId: 't-alpha',
    email: 'a@alpha.test',
    role: 'owner',
    status: 'active',
    lastLoginAt: '2026-05-14T12:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    userId: 'u-2',
    tenantId: 't-beta',
    email: 'b@beta.test',
    role: 'manager',
    status: 'active',
    lastLoginAt: null,
    createdAt: '2024-06-01T00:00:00.000Z',
  },
];

function stub(rows: ListUsersOutput['rows']): UsersServicePort {
  return {
    async listUsers(args) {
      const filtered = rows.filter(
        (r) =>
          (args.tenantId === null || r.tenantId === args.tenantId) &&
          (args.role === null || r.role === args.role),
      );
      return {
        rows: filtered.slice(0, args.limit),
        nextCursor: null,
        totalReturned: Math.min(filtered.length, args.limit),
      };
    },
  };
}

describe('platform.list_users', () => {
  it('happy path — platform admin lists all users', async () => {
    const tool = createListUsersTool({ usersService: stub(SEED) });
    const out = await tool.execute({}, buildCtx());
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows).toHaveLength(2);
  });

  it('auth-gated — caller without platform:users:read is refused', async () => {
    const tool = createListUsersTool({ usersService: stub(SEED) });
    const out = await tool.execute({}, buildCtx({ scopes: ['platform:foo:read'] }));
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant filter the caller cannot reach', async () => {
    const tool = createListUsersTool({ usersService: stub(SEED) });
    const out = await tool.execute(
      { tenantId: 't-beta' },
      buildCtx({
        scopes: ['platform:users:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('input validation — role enum rejects unknown', () => {
    const tool = createListUsersTool({ usersService: stub(SEED) });
    expect(
      tool.inputSchema.safeParse({ role: 'sovereign-god' as unknown }).success,
    ).toBe(false);
  });

  it('filters out users on tenants the caller cannot reach', async () => {
    const tool = createListUsersTool({ usersService: stub(SEED) });
    const out = await tool.execute(
      {},
      buildCtx({
        scopes: ['platform:users:read', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.rows.map((r) => r.tenantId)).toEqual(['t-alpha']);
  });
});
