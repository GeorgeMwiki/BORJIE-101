import { describe, expect, it, vi } from 'vitest';
import { createRecipeRepository } from '../storage/recipe-repository.js';
import type { RecipeDb } from '../storage/recipe-repository.js';

function fakeDb(handler: (query: string, params: ReadonlyArray<unknown>) => unknown): RecipeDb {
  return {
    async query<T = unknown>(query: string, params: ReadonlyArray<unknown> = []) {
      const out = handler(query, params);
      return (Array.isArray(out) ? out : []) as ReadonlyArray<T>;
    },
  };
}

describe('createRecipeRepository.listLive', () => {
  it('maps SELECT rows into TabRecipeRow values', async () => {
    const repo = createRecipeRepository(
      fakeDb(() => [
        {
          id: 'buyer_kyb_start',
          version: 1,
          status: 'live',
          intent: 'BuyerKYBStart',
          compose_fn_ref: 'ref',
          authority_tier: 1,
          brand: 'borjie',
          promoted_at: '2026-04-01T00:00:00.000Z',
          promoted_by: 'owner',
          locked_at: null,
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ]),
    );
    const rows = await repo.listLive();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'buyer_kyb_start',
      version: 1,
      status: 'live',
      authorityTier: 1,
      brand: 'borjie',
    });
  });

  it('throws on missing required columns', async () => {
    const repo = createRecipeRepository(
      fakeDb(() => [
        {
          // missing id
          version: 1,
          status: 'live',
          intent: 'X',
          compose_fn_ref: 'r',
          authority_tier: 0,
          brand: 'borjie',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ]),
    );
    await expect(repo.listLive()).rejects.toThrow();
  });

  it('coerces string ints and accepts Date objects', async () => {
    const repo = createRecipeRepository(
      fakeDb(() => [
        {
          id: 'r',
          version: '2', // string
          status: 'live',
          intent: 'X',
          compose_fn_ref: 'ref',
          authority_tier: '2',
          brand: 'borjie',
          promoted_at: new Date('2026-04-01T00:00:00.000Z'),
          promoted_by: null,
          locked_at: null,
          created_at: new Date('2026-04-01T00:00:00.000Z'),
          updated_at: new Date('2026-04-01T00:00:00.000Z'),
        },
      ]),
    );
    const rows = await repo.listLive();
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.authorityTier).toBe(2);
  });
});

describe('createRecipeRepository.findVersion', () => {
  it('returns null when no row found', async () => {
    const repo = createRecipeRepository(fakeDb(() => []));
    const r = await repo.findVersion('r', 1);
    expect(r).toBeNull();
  });

  it('returns the mapped row when present', async () => {
    const repo = createRecipeRepository(
      fakeDb(() => [
        {
          id: 'r',
          version: 1,
          status: 'shadow',
          intent: 'X',
          compose_fn_ref: 'ref',
          authority_tier: 1,
          brand: 'borjie',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ]),
    );
    const r = await repo.findVersion('r', 1);
    expect(r?.status).toBe('shadow');
  });
});

describe('createRecipeRepository.updateStatus', () => {
  it('passes through to db.query with the right params', async () => {
    const calls: Array<{ query: string; params: ReadonlyArray<unknown> }> = [];
    const repo = createRecipeRepository(
      fakeDb((query, params) => {
        calls.push({ query, params });
        return [];
      }),
    );
    await repo.updateStatus({
      id: 'r',
      version: 1,
      nextStatus: 'locked',
      lockedAtIso: '2026-05-01T00:00:00.000Z',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params[0]).toBe('r');
    expect(calls[0]?.params[1]).toBe(1);
    expect(calls[0]?.params[2]).toBe('locked');
  });
});

describe('createRecipeRepository.insertShadow', () => {
  it('issues an INSERT with the right columns', async () => {
    const calls: Array<{ query: string; params: ReadonlyArray<unknown> }> = [];
    const repo = createRecipeRepository(
      fakeDb((query, params) => {
        calls.push({ query, params });
        return [];
      }),
    );
    await repo.insertShadow({
      id: 'r',
      version: 2,
      intent: 'X',
      composeFnRef: 'ref',
      authorityTier: 1,
    });
    expect(calls[0]?.query).toMatch(/INSERT INTO tab_recipes/);
    expect(calls[0]?.params[1]).toBe(2);
  });
});

describe('createRecipeRepository.isLocked', () => {
  it('returns true when row status is locked', async () => {
    const repo = createRecipeRepository(fakeDb(() => [{ status: 'locked' }]));
    expect(await repo.isLocked({ id: 'r', version: 1 })).toBe(true);
  });
  it('returns false when row status is live', async () => {
    const repo = createRecipeRepository(fakeDb(() => [{ status: 'live' }]));
    expect(await repo.isLocked({ id: 'r', version: 1 })).toBe(false);
  });
  it('returns false when no row', async () => {
    const repo = createRecipeRepository(fakeDb(() => []));
    expect(await repo.isLocked({ id: 'r', version: 1 })).toBe(false);
  });
});
