import { describe, it, expect } from 'vitest';
import {
  createCreateUserTool,
  type CreateUserOutput,
  type CreateUserPort,
} from '../platform.create_user.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(opts: {
  tenants?: ReadonlyArray<string>;
  existing?: ReadonlyArray<{ tenantId: string; email: string }>;
} = {}): {
  port: CreateUserPort;
  deactivated: string[];
} {
  const deactivated: string[] = [];
  return {
    deactivated,
    port: {
      async tenantExists(t) {
        return (opts.tenants ?? ['t-alpha']).includes(t);
      },
      async emailExistsOnTenant({ tenantId, email }) {
        return (opts.existing ?? []).some(
          (e) => e.tenantId === tenantId && e.email === email,
        );
      },
      async createUser(args): Promise<CreateUserOutput> {
        return {
          userId: `u-${args.tenantId}-${args.email}`,
          tenantId: args.tenantId,
          email: args.email,
          role: args.role,
          status: args.sendInvite ? 'invited' : 'active',
          invitedAt: args.sendInvite ? '2026-05-15T09:00:00.000Z' : null,
          createdAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async deactivateUser(userId) {
        deactivated.push(userId);
      },
    },
  };
}

describe('platform.create_user', () => {
  it('happy path — creates an invited user', async () => {
    const { port } = stub();
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      {
        tenantId: 't-alpha',
        email: 'new@alpha.test',
        role: 'manager',
        sendInvite: true,
      },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('invited');
    expect(out.output.invitedAt).not.toBeNull();
  });

  it('auth-gated — caller missing users:write refused', async () => {
    const { port } = stub();
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      { tenantId: 't-alpha', email: 'x@y.test', role: 'manager' },
      buildCtx({ scopes: ['platform:users:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant the caller cannot reach', async () => {
    const { port } = stub();
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      { tenantId: 't-beta', email: 'x@y.test', role: 'manager' },
      buildCtx({
        scopes: ['platform:users:write', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses unknown tenant', async () => {
    const { port } = stub();
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      { tenantId: 't-does-not-exist', email: 'x@y.test', role: 'manager' },
      buildCtx(),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('TENANT_NOT_FOUND');
  });

  it('refuses duplicate email on same tenant', async () => {
    const { port } = stub({
      existing: [{ tenantId: 't-alpha', email: 'taken@alpha.test' }],
    });
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      { tenantId: 't-alpha', email: 'taken@alpha.test', role: 'manager' },
      buildCtx(),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('ALREADY_APPLIED');
  });

  it('rollback deactivates the user', async () => {
    const { port, deactivated } = stub();
    const tool = createCreateUserTool({ usersService: port });
    const out = await tool.execute(
      { tenantId: 't-alpha', email: 'new@alpha.test', role: 'manager' },
      buildCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx());
    expect(deactivated).toEqual([out.output.userId]);
  });
});
