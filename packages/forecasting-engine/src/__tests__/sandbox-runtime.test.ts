import { describe, it, expect } from 'vitest';
import { createSandbox } from '../sandbox/sandbox-runtime.js';
import { planSchemaClone } from '../sandbox/schema-clone.js';
import { EphemeralCleanup } from '../sandbox/ephemeral-cleanup.js';
import { checkHost, checkTableWrite } from '../sandbox/isolation-policy.js';

describe('sandbox-runtime', () => {
  it('creates an in-memory sandbox by default', async () => {
    const { sandbox, plan } = await createSandbox();
    expect(sandbox.mode).toBe('in-memory');
    expect(plan).toBeUndefined();
    await sandbox.dispose();
  });

  it('round-trips read + write', async () => {
    const { sandbox } = await createSandbox();
    await sandbox.write('kv:greeting', { hello: 'world' });
    const got = await sandbox.read<{ hello: string }>('kv:greeting');
    expect(got?.hello).toBe('world');
    await sandbox.dispose();
  });

  it('rejects writes to forbidden tables', async () => {
    const { sandbox } = await createSandbox();
    await expect(
      sandbox.write('sovereign_action_ledger:abc', {}),
    ).rejects.toThrow(/forbidden/i);
    await sandbox.dispose();
  });

  it('throws after dispose', async () => {
    const { sandbox } = await createSandbox();
    await sandbox.dispose();
    expect(sandbox.isDisposed()).toBe(true);
    await expect(sandbox.read('any')).rejects.toThrow(/disposed/i);
  });

  it('returns a schema-clone plan in schema-clone mode', async () => {
    const { plan } = await createSandbox({ mode: 'schema-clone' });
    expect(plan).toBeDefined();
    expect(plan?.statements[0]).toMatch(/CREATE SCHEMA/);
    expect(plan?.dropStatement).toMatch(/DROP SCHEMA/);
  });
});

describe('schema-clone planner', () => {
  it('rejects unsafe runId', () => {
    expect(() => planSchemaClone({ runId: 'evil; DROP TABLE' })).toThrow();
  });

  it('produces deterministic schema name', () => {
    const p1 = planSchemaClone({ runId: 'abc', nowMs: 1, ttlMs: 1000 });
    expect(p1.schemaName).toBe('sandbox_abc');
  });
});

describe('EphemeralCleanup', () => {
  it('sweeps expired entries and calls dispose', async () => {
    const reg = new EphemeralCleanup();
    let disposed = false;
    reg.register({
      runId: 'old',
      createdAtMs: 0,
      ttlMs: 1000,
      dispose: async () => {
        disposed = true;
      },
    });
    const expired = await reg.sweep(60_000);
    expect(disposed).toBe(true);
    expect(expired).toContain('old');
    expect(reg.size()).toBe(0);
  });

  it('keeps unexpired entries', async () => {
    const reg = new EphemeralCleanup();
    reg.register({
      runId: 'fresh',
      createdAtMs: 1_000_000,
      ttlMs: 1000_000,
      dispose: async () => {},
    });
    const expired = await reg.sweep(1_000_500);
    expect(expired.length).toBe(0);
    expect(reg.size()).toBe(1);
  });
});

describe('isolation-policy', () => {
  it('blocks forbidden hosts', () => {
    expect(checkHost('api.stripe.com').allowed).toBe(false);
    expect(checkHost('example.com').allowed).toBe(true);
  });

  it('blocks forbidden table writes', () => {
    expect(checkTableWrite('sovereign_action_ledger').allowed).toBe(false);
    expect(checkTableWrite('scratch').allowed).toBe(true);
  });
});
