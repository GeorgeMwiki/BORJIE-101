/**
 * Unit tests for createKernelPromptRegistryService.
 *
 * Stubs the Drizzle DatabaseClient with an in-memory table that
 * supports the small subset of operations the service exercises
 * (select+where+limit+orderBy, insert+values, update+set+where).
 *
 * Covers: shadow registration, state-machine transitions,
 * single-active invariant on promotion, rollback restore semantics,
 * markDegraded path, read paths, and degraded-DB graceful-failure.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createKernelPromptRegistryService } from './kernel-prompt-registry.service.js';
import type { DatabaseClient } from '../client.js';

interface InMemRow {
  id: string;
  capability: string;
  version: string;
  promptText: string;
  goldenSetVersion: string;
  status: string;
  promotedAt: Date;
  promotedBy: string;
  archivedAt: Date | null;
  archivedReason: string | null;
  metadata: Record<string, unknown>;
}

interface StubDb {
  client: DatabaseClient;
  rows: InMemRow[];
  forceReadError: boolean;
  forceUpdateError: boolean;
}

function makeStub(): StubDb {
  const state: StubDb = {
    client: null as unknown as DatabaseClient,
    rows: [],
    forceReadError: false,
    forceUpdateError: false,
  };

  const makeSelectChain = (): unknown => {
    let pred: ((r: InMemRow) => boolean) | null = null;
    let orderDesc: keyof InMemRow | null = null;
    let lim: number | null = null;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (clause: unknown) => {
        // The Drizzle predicate object carries the raw values we
        // need via toString() in real life; in this stub we drive
        // matching through a sidecar field set just before each
        // call. We sniff the `clause` for an embedded "version"
        // marker passed by the helpers below.
        const marker = (clause as { __marker?: (r: InMemRow) => boolean })?.__marker;
        if (marker) pred = marker;
        return chain;
      },
      limit: (n: number) => {
        lim = n;
        return chain;
      },
      orderBy: (col: unknown) => {
        const marker = (col as { __orderBy?: keyof InMemRow })?.__orderBy;
        if (marker) orderDesc = marker;
        return chain;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        if (state.forceReadError) {
          const err = new Error('forced read error');
          if (reject) return reject(err);
          throw err;
        }
        let out = pred ? state.rows.filter(pred) : [...state.rows];
        if (orderDesc) {
          out = [...out].sort((a, b) => {
            const av = a[orderDesc!] as unknown as number | string | Date | null;
            const bv = b[orderDesc!] as unknown as number | string | Date | null;
            if (av instanceof Date && bv instanceof Date) {
              return bv.getTime() - av.getTime();
            }
            return String(bv ?? '').localeCompare(String(av ?? ''));
          });
        }
        if (lim != null) out = out.slice(0, lim);
        return resolve(out);
      },
    };
    return chain;
  };

  const makeInsertChain = (table: unknown): unknown => {
    let pendingValues: InMemRow | null = null;
    const chain: Record<string, unknown> = {
      values: (v: InMemRow) => {
        pendingValues = v;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (state.forceUpdateError) throw new Error('forced insert error');
        if (pendingValues) {
          state.rows.push({
            ...pendingValues,
            archivedAt: pendingValues.archivedAt ?? null,
            archivedReason: pendingValues.archivedReason ?? null,
            metadata: pendingValues.metadata ?? {},
          });
        }
        return resolve(undefined);
      },
    };
    void table;
    return chain;
  };

  const makeUpdateChain = (): unknown => {
    let pendingSet: Partial<InMemRow> | null = null;
    let pred: ((r: InMemRow) => boolean) | null = null;
    const chain: Record<string, unknown> = {
      set: (v: Partial<InMemRow>) => {
        pendingSet = v;
        return chain;
      },
      where: (clause: unknown) => {
        const marker = (clause as { __marker?: (r: InMemRow) => boolean })?.__marker;
        if (marker) pred = marker;
        return chain;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        if (state.forceUpdateError) {
          const err = new Error('forced update error');
          if (reject) return reject(err);
          throw err;
        }
        if (pendingSet && pred) {
          for (const r of state.rows) {
            if (pred(r)) Object.assign(r, pendingSet);
          }
        }
        return resolve(undefined);
      },
    };
    return chain;
  };

  state.client = {
    select: () => makeSelectChain(),
    insert: (table: unknown) => makeInsertChain(table),
    update: () => makeUpdateChain(),
  } as unknown as DatabaseClient;
  return state;
}

// ─────────────────────────────────────────────────────────────────────
// `and` / `eq` / `desc` / `sql` from drizzle-orm — the service
// composes these into the predicate. We intercept by monkey-patching
// the module so each helper attaches a `__marker` closure to the
// returned predicate object that the stub can read back.
// ─────────────────────────────────────────────────────────────────────

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>(
    'drizzle-orm',
  );
  const fieldName = (col: unknown): string => {
    if (!col || typeof col !== 'object') return '';
    const c = col as { name?: string; columnName?: string };
    return c.name ?? c.columnName ?? '';
  };
  return {
    ...actual,
    and: (...clauses: unknown[]) => {
      const markers = clauses
        .map((c) => (c as { __marker?: (r: InMemRow) => boolean })?.__marker)
        .filter(Boolean) as Array<(r: InMemRow) => boolean>;
      return {
        __marker: (r: InMemRow) => markers.every((m) => m(r)),
      };
    },
    eq: (col: unknown, value: unknown) => {
      const name = fieldName(col);
      const camel: Record<string, keyof InMemRow> = {
        capability: 'capability',
        version: 'version',
        status: 'status',
        id: 'id',
        prompt_text: 'promptText',
        golden_set_version: 'goldenSetVersion',
        promoted_at: 'promotedAt',
        promoted_by: 'promotedBy',
        archived_at: 'archivedAt',
        archived_reason: 'archivedReason',
        metadata: 'metadata',
      };
      const key = camel[name] ?? (name as keyof InMemRow);
      return {
        __marker: (r: InMemRow) => r[key] === value,
      };
    },
    desc: (col: unknown) => {
      const name = fieldName(col);
      const camel: Record<string, keyof InMemRow> = {
        promoted_at: 'promotedAt',
        archived_at: 'archivedAt',
      };
      const key = camel[name] ?? (name as keyof InMemRow);
      return { __orderBy: key };
    },
    sql: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // The service uses `sql\`${col} = ANY(${arr})\`` in one place
      // (readByStatus). We turn the first array value back into a
      // predicate over `status`.
      const arr = values.find((v) => Array.isArray(v)) as string[] | undefined;
      if (arr) {
        return {
          __marker: (r: InMemRow) => arr.includes(r.status),
        };
      }
      return { __marker: () => true };
    },
  };
});

describe('createKernelPromptRegistryService', () => {
  let stub: StubDb;
  let svc: ReturnType<typeof createKernelPromptRegistryService>;
  let errorSpy = vi.spyOn(console, 'error');

  beforeEach(() => {
    stub = makeStub();
    svc = createKernelPromptRegistryService(stub.client);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('registers a shadow variant with capability/version/promptText', async () => {
    const row = await svc.registerShadow({
      capability: 'support-bot',
      version: 'v1',
      promptText: 'You are a helpful agent.',
      goldenSetVersion: 'gs-2026-05-17',
      promotedBy: 'admin@acme.io',
    });
    expect(row.status).toBe('shadow');
    expect(row.capability).toBe('support-bot');
    expect(row.version).toBe('v1');
    expect(row.promptText).toContain('helpful');
  });

  it('refuses to register duplicate (capability, version)', async () => {
    await svc.registerShadow({
      capability: 'support-bot',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs-1',
      promotedBy: 'a@x',
    });
    await expect(
      svc.registerShadow({
        capability: 'support-bot',
        version: 'v1',
        promptText: 'y',
        goldenSetVersion: 'gs-2',
        promotedBy: 'b@x',
      }),
    ).rejects.toThrow(/already registered/);
  });

  it('rejects registerShadow with missing required fields', async () => {
    await expect(
      svc.registerShadow({
        capability: '',
        version: 'v1',
        promptText: 'x',
        goldenSetVersion: 'gs-1',
        promotedBy: 'a@x',
      }),
    ).rejects.toThrow(/required/);
  });

  it('promotes shadow → canary', async () => {
    await svc.registerShadow({
      capability: 'support-bot',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs-1',
      promotedBy: 'a@x',
    });
    const promoted = await svc.promote({
      capability: 'support-bot',
      version: 'v1',
      toStatus: 'canary',
      promotedBy: 'a@x',
    });
    expect(promoted.status).toBe('canary');
  });

  it('promotes canary → canary-25', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    const promoted = await svc.promote({
      capability: 'c',
      version: 'v1',
      toStatus: 'canary-25',
      promotedBy: 'a',
    });
    expect(promoted.status).toBe('canary-25');
  });

  it('refuses illegal state transition shadow → active', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await expect(
      svc.promote({ capability: 'c', version: 'v1', toStatus: 'active', promotedBy: 'a' }),
    ).rejects.toThrow(/illegal status transition/);
  });

  it('promote to active demotes the prior active row to archived', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'old',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'active', promotedBy: 'a' });

    await svc.registerShadow({
      capability: 'c',
      version: 'v2',
      promptText: 'new',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'active', promotedBy: 'a' });

    const v1After = await svc.findByVersion('c', 'v1');
    const v2After = await svc.findByVersion('c', 'v2');
    expect(v1After?.status).toBe('archived');
    expect(v2After?.status).toBe('active');
    expect(v1After?.archivedReason).toContain('superseded by v2');
  });

  it('findActive returns the single active row', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'active', promotedBy: 'a' });
    const active = await svc.findActive('c');
    expect(active?.version).toBe('v1');
  });

  it('findActive returns null when no active row exists', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    const active = await svc.findActive('c');
    expect(active).toBeNull();
  });

  it('findCanaries returns all canary + canary-25 rows', async () => {
    await svc.registerShadow({
      capability: 'c',
      version: 'v1',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    await svc.registerShadow({
      capability: 'c',
      version: 'v2',
      promptText: 'x',
      goldenSetVersion: 'gs',
      promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'canary-25', promotedBy: 'a' });
    const cans = await svc.findCanaries('c');
    expect(cans.map((r) => r.version).sort()).toEqual(['v1', 'v2']);
  });

  it('rollback archives current active and restores prior active', async () => {
    // v1 → active
    await svc.registerShadow({
      capability: 'c', version: 'v1', promptText: 'x', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'active', promotedBy: 'a' });
    // v2 → active (v1 → archived "superseded by v2")
    await svc.registerShadow({
      capability: 'c', version: 'v2', promptText: 'y', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v2', toStatus: 'active', promotedBy: 'a' });

    const result = await svc.rollback({ capability: 'c', reason: 'high refusal rate', promotedBy: 'op@x' });
    expect(result.previousActive?.version).toBe('v2');
    expect(result.previousActive?.status).toBe('archived');
    expect(result.previousActive?.archivedReason).toContain('rollback: high refusal rate');
    expect(result.restoredActive?.version).toBe('v1');
    expect(result.restoredActive?.status).toBe('active');
  });

  it('rollback with no active row returns nulls', async () => {
    const r = await svc.rollback({ capability: 'c', reason: 'nothing', promotedBy: 'a' });
    expect(r.previousActive).toBeNull();
    expect(r.restoredActive).toBeNull();
  });

  it('markDegraded marks a canary row degraded', async () => {
    await svc.registerShadow({
      capability: 'c', version: 'v1', promptText: 'x', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    const out = await svc.markDegraded('c', 'v1', 'slo breach: completion-rate');
    expect(out?.status).toBe('degraded');
    expect(out?.archivedReason).toContain('slo breach');
  });

  it('markDegraded is a no-op on an archived row', async () => {
    await svc.registerShadow({
      capability: 'c', version: 'v1', promptText: 'x', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'active', promotedBy: 'a' });
    await svc.rollback({ capability: 'c', reason: 'x', promotedBy: 'a' });
    const out = await svc.markDegraded('c', 'v1', 'late breach');
    expect(out?.status).toBe('archived');
  });

  it('markDegraded returns null when the row does not exist', async () => {
    const out = await svc.markDegraded('c', 'ghost', 'reason');
    expect(out).toBeNull();
  });

  it('listForCapability returns all rows ordered by promoted_at DESC', async () => {
    await svc.registerShadow({
      capability: 'c', version: 'v1', promptText: 'x', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    // Small delay so promotedAt timestamps differ at ms resolution.
    await new Promise((r) => setTimeout(r, 5));
    await svc.registerShadow({
      capability: 'c', version: 'v2', promptText: 'y', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    const rows = await svc.listForCapability('c');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.version).toBe('v2');
    expect(rows[1]!.version).toBe('v1');
  });

  it('findShadows returns only shadow rows', async () => {
    await svc.registerShadow({
      capability: 'c', version: 'v1', promptText: 'x', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.registerShadow({
      capability: 'c', version: 'v2', promptText: 'y', goldenSetVersion: 'gs', promotedBy: 'a',
    });
    await svc.promote({ capability: 'c', version: 'v1', toStatus: 'canary', promotedBy: 'a' });
    const shadows = await svc.findShadows('c');
    expect(shadows.map((r) => r.version)).toEqual(['v2']);
  });

  it('listForCapability degrades to [] when the DB read throws', async () => {
    stub.forceReadError = true;
    const rows = await svc.listForCapability('c');
    expect(rows).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('findByVersion degrades to null when the DB read throws', async () => {
    stub.forceReadError = true;
    const row = await svc.findByVersion('c', 'v1');
    expect(row).toBeNull();
  });

  it('promote throws when the (capability, version) row is missing', async () => {
    await expect(
      svc.promote({ capability: 'c', version: 'ghost', toStatus: 'canary', promotedBy: 'a' }),
    ).rejects.toThrow(/not found/);
  });
});
