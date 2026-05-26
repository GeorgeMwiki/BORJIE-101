import { describe, expect, it } from 'vitest';
import { createTelemetryRepository } from '../storage/telemetry-repository.js';
import type { RecipeDb } from '../storage/recipe-repository.js';

function fakeDb(rows: ReadonlyArray<Record<string, unknown>>): RecipeDb {
  return {
    async query<T = unknown>() {
      return rows as ReadonlyArray<T>;
    },
  };
}

describe('createTelemetryRepository.readEventsForRecipe', () => {
  it('returns parsed events', async () => {
    const repo = createTelemetryRepository(
      fakeDb([
        {
          id: 'e1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          tab_recipe_version: 1,
          session_id: 's1',
          field_id: 'tin',
          event_kind: 'focus',
          recorded_at: '2026-05-10T12:00:00.000Z',
        },
      ]),
    );
    const events = await repo.readEventsForRecipe({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      sinceIso: '2026-05-01',
      untilIso: '2026-06-01',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventKind).toBe('focus');
    expect(events[0]?.fieldId).toBe('tin');
  });

  it('drops rows with invalid event_kind', async () => {
    const repo = createTelemetryRepository(
      fakeDb([
        {
          id: 'e1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          tab_recipe_version: 1,
          session_id: 's1',
          field_id: null,
          event_kind: 'bogus',
          recorded_at: '2026-05-10T12:00:00.000Z',
        },
      ]),
    );
    const events = await repo.readEventsForRecipe({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      sinceIso: '2026-05-01',
      untilIso: '2026-06-01',
    });
    expect(events).toHaveLength(0);
  });

  it('drops rows missing required ids', async () => {
    const repo = createTelemetryRepository(
      fakeDb([
        {
          id: null,
          tenant_id: 't1',
          tab_recipe_id: 'r',
          tab_recipe_version: 1,
          event_kind: 'focus',
          recorded_at: '2026-05-10T12:00:00.000Z',
        },
      ]),
    );
    const events = await repo.readEventsForRecipe({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      sinceIso: '2026-05-01',
      untilIso: '2026-06-01',
    });
    expect(events).toHaveLength(0);
  });

  it('accepts Date objects for recorded_at', async () => {
    const repo = createTelemetryRepository(
      fakeDb([
        {
          id: 'e1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          tab_recipe_version: 1,
          session_id: null,
          field_id: null,
          event_kind: 'render',
          recorded_at: new Date('2026-05-10T12:00:00.000Z'),
        },
      ]),
    );
    const events = await repo.readEventsForRecipe({
      tabRecipeId: 'r',
      tabRecipeVersion: 1,
      sinceIso: '2026-05-01',
      untilIso: '2026-06-01',
    });
    expect(events[0]?.recordedAt).toBe('2026-05-10T12:00:00.000Z');
  });

  it('coerces string versions to int', async () => {
    const repo = createTelemetryRepository(
      fakeDb([
        {
          id: 'e1',
          tenant_id: 't1',
          tab_recipe_id: 'r',
          tab_recipe_version: '3',
          session_id: null,
          field_id: null,
          event_kind: 'render',
          recorded_at: '2026-05-10T12:00:00.000Z',
        },
      ]),
    );
    const events = await repo.readEventsForRecipe({
      tabRecipeId: 'r',
      tabRecipeVersion: 3,
      sinceIso: '2026-05-01',
      untilIso: '2026-06-01',
    });
    expect(events[0]?.tabRecipeVersion).toBe(3);
  });
});
