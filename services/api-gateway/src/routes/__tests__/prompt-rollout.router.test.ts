/**
 * prompt-rollout router — admin gate + happy paths + error envelopes.
 *
 * Mounts the router with an in-memory registry stub so we can drive
 * every status transition path without a DB. Tests cover the four
 * endpoints + admin-gate enforcement + ledger-sink invocation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createPromptRolloutRouter,
  type KernelPromptRegistryServiceLike,
  type PromptVersionRowLike,
  type RolloutLedgerSinkLike,
} from '../prompt-rollout.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

function bearer(role: UserRole): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory registry stub. Real DB throws on invalid transitions; the
// stub mirrors that contract so we can also exercise the 400 path.
// ─────────────────────────────────────────────────────────────────────

function makeStubRegistry(): {
  service: KernelPromptRegistryServiceLike;
  state: PromptVersionRowLike[];
  failNextWrite: { value: boolean };
} {
  const state: PromptVersionRowLike[] = [];
  const failNextWrite = { value: false };

  const find = (capability: string, version: string): PromptVersionRowLike | undefined =>
    state.find((r) => r.capability === capability && r.version === version);

  const service: KernelPromptRegistryServiceLike = {
    async listForCapability(capability) {
      return state.filter((r) => r.capability === capability);
    },
    async registerShadow(args) {
      if (failNextWrite.value) {
        failNextWrite.value = false;
        throw new Error('forced registerShadow failure');
      }
      if (find(args.capability, args.version)) {
        throw new Error('already registered');
      }
      const row: PromptVersionRowLike = {
        id: `id-${state.length + 1}`,
        capability: args.capability,
        version: args.version,
        promptText: args.promptText,
        goldenSetVersion: args.goldenSetVersion,
        status: 'shadow',
        promotedAt: new Date().toISOString(),
        promotedBy: args.promotedBy,
        archivedAt: null,
        archivedReason: null,
        metadata: args.metadata ?? {},
      };
      state.push(row);
      return row;
    },
    async promote(args) {
      const row = find(args.capability, args.version);
      if (!row) throw new Error('not found');
      const legal: Readonly<Record<string, ReadonlyArray<string>>> = {
        shadow: ['canary'],
        canary: ['canary-25', 'active', 'shadow'],
        'canary-25': ['active', 'canary'],
        active: ['archived'],
      };
      if (!(legal[row.status] ?? []).includes(args.toStatus)) {
        throw new Error(`illegal status transition ${row.status} -> ${args.toStatus}`);
      }
      if (args.toStatus === 'active') {
        const cur = state.find(
          (r) =>
            r.capability === args.capability &&
            r.status === 'active' &&
            r.version !== args.version,
        );
        if (cur) {
          (cur as { status: string }).status = 'archived';
          (cur as { archivedReason: string | null }).archivedReason = `superseded by ${args.version}`;
          (cur as { archivedAt: string | null }).archivedAt = new Date().toISOString();
        }
      }
      (row as { status: string }).status = args.toStatus;
      (row as { promotedAt: string }).promotedAt = new Date().toISOString();
      (row as { promotedBy: string }).promotedBy = args.promotedBy;
      return row;
    },
    async rollback(args) {
      const active = state.find((r) => r.capability === args.capability && r.status === 'active');
      if (!active) return { previousActive: null, restoredActive: null };
      (active as { status: string }).status = 'archived';
      (active as { archivedReason: string | null }).archivedReason = `rollback: ${args.reason}`;
      (active as { archivedAt: string | null }).archivedAt = new Date().toISOString();
      const prior = state.find(
        (r) =>
          r.capability === args.capability &&
          r.status === 'archived' &&
          r.version !== active.version &&
          (r.archivedReason ?? '').startsWith('superseded'),
      );
      if (prior) {
        (prior as { status: string }).status = 'active';
        (prior as { archivedReason: string | null }).archivedReason = null;
        (prior as { archivedAt: string | null }).archivedAt = null;
      }
      return { previousActive: active, restoredActive: prior ?? null };
    },
  };

  return { service, state, failNextWrite };
}

function mount(deps: {
  registry: KernelPromptRegistryServiceLike;
  ledgerSink?: RolloutLedgerSinkLike;
}): Hono {
  const app = new Hono();
  const router = createPromptRolloutRouter(deps);
  app.route('/api/v1/prompts', router);
  return app;
}

describe('prompt-rollout router — auth gate', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('rejects GET without Authorization header (401)', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/support/versions');
    expect(res.status).toBe(401);
  });

  it('rejects POST as RESIDENT (403)', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/support/shadow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.RESIDENT),
      },
      body: JSON.stringify({ version: 'v1', promptText: 'x', goldenSetVersion: 'gs' }),
    });
    expect([401, 403]).toContain(res.status);
  });

  it('rejects POST as TENANT_ADMIN (platform-only gate)', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/support/promote', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.TENANT_ADMIN),
      },
      body: JSON.stringify({ version: 'v1', toStatus: 'canary' }),
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe('prompt-rollout router — happy paths', () => {
  it('GET /:capability/versions returns the list', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    // Pre-populate via API.
    await app.request('/api/v1/prompts/support/shadow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.ADMIN),
      },
      body: JSON.stringify({ version: 'v1', promptText: 'p', goldenSetVersion: 'gs' }),
    });
    const res = await app.request('/api/v1/prompts/support/versions', {
      headers: { Authorization: bearer(UserRole.ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { versions: PromptVersionRowLike[] } };
    expect(body.success).toBe(true);
    expect(body.data.versions.length).toBe(1);
    expect(body.data.versions[0]!.version).toBe('v1');
  });

  it('POST /:capability/shadow registers a new shadow row', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/support/shadow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.SUPER_ADMIN),
      },
      body: JSON.stringify({
        version: 'v1',
        promptText: 'You are helpful.',
        goldenSetVersion: 'gs-2026-05-17',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: PromptVersionRowLike };
    expect(body.data.status).toBe('shadow');
  });

  it('POST /:capability/promote walks shadow → canary → active', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    await app.request('/api/v1/prompts/support/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p', goldenSetVersion: 'gs' }),
    });
    let res = await app.request('/api/v1/prompts/support/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'canary' }),
    });
    expect(res.status).toBe(200);
    res = await app.request('/api/v1/prompts/support/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: PromptVersionRowLike };
    expect(body.data.status).toBe('active');
  });

  it('POST /:capability/rollback restores prior active', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });

    // v1 → active
    await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p1', goldenSetVersion: 'gs' }),
    });
    await app.request('/api/v1/prompts/c/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'canary' }),
    });
    await app.request('/api/v1/prompts/c/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'active' }),
    });
    // v2 → active (v1 → archived/superseded)
    await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v2', promptText: 'p2', goldenSetVersion: 'gs' }),
    });
    await app.request('/api/v1/prompts/c/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v2', toStatus: 'canary' }),
    });
    await app.request('/api/v1/prompts/c/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v2', toStatus: 'active' }),
    });

    const res = await app.request('/api/v1/prompts/c/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ reason: 'completion-rate breach' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        previousActive: PromptVersionRowLike | null;
        restoredActive: PromptVersionRowLike | null;
      };
    };
    expect(body.data.previousActive?.version).toBe('v2');
    expect(body.data.previousActive?.status).toBe('archived');
    expect(body.data.restoredActive?.version).toBe('v1');
    expect(body.data.restoredActive?.status).toBe('active');
  });

  it('writes a ledger entry on rollback', async () => {
    const stub = makeStubRegistry();
    const ledgerCalls: Array<{ capability: string; previousVersion: string | null }> = [];
    const ledgerSink: RolloutLedgerSinkLike = {
      recordRollback: (e) => {
        ledgerCalls.push({ capability: e.capability, previousVersion: e.previousVersion });
      },
    };
    const app = mount({ registry: stub.service, ledgerSink });

    await app.request('/api/v1/prompts/cap/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p1', goldenSetVersion: 'gs' }),
    });
    await app.request('/api/v1/prompts/cap/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'canary' }),
    });
    await app.request('/api/v1/prompts/cap/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'active' }),
    });

    await app.request('/api/v1/prompts/cap/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ reason: 'unit test' }),
    });

    expect(ledgerCalls.length).toBe(1);
    expect(ledgerCalls[0]!.capability).toBe('cap');
    expect(ledgerCalls[0]!.previousVersion).toBe('v1');
  });
});

describe('prompt-rollout router — error envelopes', () => {
  it('returns 400 when registry.registerShadow throws', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    // Insert once.
    await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p', goldenSetVersion: 'gs' }),
    });
    // Duplicate insert → 400.
    const res = await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p', goldenSetVersion: 'gs' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SHADOW_REGISTRATION_FAILED');
  });

  it('returns 400 on an illegal promote transition (shadow → active)', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', promptText: 'p', goldenSetVersion: 'gs' }),
    });
    const res = await app.request('/api/v1/prompts/c/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ version: 'v1', toStatus: 'active' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on a malformed shadow body', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/c/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ /* missing version */ promptText: 'p', goldenSetVersion: 'gs' }),
    });
    expect(res.status).toBe(400);
  });

  it('rollback with no active row succeeds with null result', async () => {
    const stub = makeStubRegistry();
    const app = mount({ registry: stub.service });
    const res = await app.request('/api/v1/prompts/c/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(UserRole.ADMIN) },
      body: JSON.stringify({ reason: 'nothing to roll' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { previousActive: unknown; restoredActive: unknown };
    };
    expect(body.data.previousActive).toBeNull();
    expect(body.data.restoredActive).toBeNull();
  });
});
