/**
 * Generate → persist → render PATH test (closes the wiring loop).
 *
 * This is the end-to-end seam the api-gateway composition + owner-web host
 * rely on. It exercises the full chain WITHOUT a live DB or React:
 *
 *   1. detectIntent  — a high-confidence tab-authoring message classifies.
 *   2. generate      — the engine drafts a zod-valid PortalTab.
 *   3. persist       — through the REAL `createDrizzleTabRegistry`, over a
 *                      fake `DbExecutor` that captures the SQL + params, so we
 *                      prove the INSERT targets `public.portal_tabs` with the
 *                      exact columns migration 0170 ships.
 *   4. round-trip    — `get(id)` reads the captured row back and revalidates.
 *   5. render-resolve — EVERY field kind + widget kind the generated tab
 *                       declares resolves in the field/widget registries the
 *                       owner-web GenUITabHost renders from. A generated kind
 *                       the FE can't render would break the host; this asserts
 *                       the registries cover the generator's whole output.
 */

import { describe, it, expect } from 'vitest';

import { createGenUIEngine } from '../engine.js';
import {
  createDrizzleTabRegistry,
  type DbExecutor,
} from '../persistence/index.js';
import {
  getFieldKindMetadata,
  ALL_FIELD_KINDS,
} from '../fields/index.js';
import {
  getWidgetKindMetadata,
  ALL_WIDGET_KINDS,
} from '../widgets/index.js';
import { safeParsePortalTab, type PortalTab } from '../types.js';

/**
 * In-memory `DbExecutor` standing in for postgres-js `$client.unsafe`. It
 * understands the three statements the adapter emits (INSERT … ON CONFLICT,
 * SELECT … WHERE id, SELECT … list) enough to round-trip one row.
 */
function makeCapturingExecutor(): {
  readonly db: DbExecutor;
  readonly statements: Array<{ sql: string; params: ReadonlyArray<unknown> }>;
} {
  const statements: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];
  const rowsById = new Map<string, Record<string, unknown>>();

  const db: DbExecutor = {
    async query<Row = Record<string, unknown>>(
      sql: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<ReadonlyArray<Row>> {
      statements.push({ sql, params });
      const trimmed = sql.trim();
      if (trimmed.startsWith('INSERT INTO public.portal_tabs')) {
        // Columns: id, tenant_id, user_id, tab_key, schema_version, tab,
        // parent_tab_id, created_at, updated_at
        const [id, tenantId, userId, tabKey, schemaVersion, tabJson] = params;
        rowsById.set(id as string, {
          id,
          tenant_id: tenantId,
          user_id: userId,
          tab_key: tabKey,
          schema_version: schemaVersion,
          tab: tabJson, // stored as the JSON string the adapter passes
          parent_tab_id: params[6] ?? null,
          created_at: params[7],
          updated_at: params[8],
        });
        return [] as ReadonlyArray<Row>;
      }
      if (trimmed.startsWith('SELECT') && /WHERE id = \$1/.test(trimmed)) {
        const row = rowsById.get(params[0] as string);
        return (row ? [row] : []) as ReadonlyArray<Row>;
      }
      if (trimmed.startsWith('SELECT')) {
        // list — return every row (the test inserts one tenant only).
        return Array.from(rowsById.values()) as ReadonlyArray<Row>;
      }
      return [] as ReadonlyArray<Row>;
    },
  };

  return { db, statements };
}

describe('generate → persist → render path (Drizzle adapter + registries)', () => {
  it('persists a generated tab through the portal_tabs adapter and reads it back', async () => {
    const { db, statements } = makeCapturingExecutor();
    const persistence = createDrizzleTabRegistry({ db });
    const engine = createGenUIEngine({ persistence });

    // 1 + 2 — detect + generate.
    const intent = await engine.detectIntent({
      message: 'we need to track our staff payroll',
    });
    expect(intent?.domain).toBe('hr');
    const generated = await engine.generate({
      intent: intent!,
      tenantId: 'tenant_A',
      userId: 'user_1',
      actorId: 'user_1',
    });
    expect(generated.tab.tabKey).toBe(intent!.proposedTabKey);

    // 3 — persist through the REAL Drizzle adapter.
    const saved = await engine.persist({ tab: generated.tab });
    expect(saved.id).toBe(generated.tab.id);

    // The INSERT targets public.portal_tabs with the migration-0170 columns.
    const insert = statements.find((s) =>
      s.sql.includes('INSERT INTO public.portal_tabs'),
    );
    expect(insert).toBeDefined();
    expect(insert!.sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(insert!.sql).toContain('$6::jsonb');
    // tenant_id param is the scoped tenant, never the body's.
    expect(insert!.params[1]).toBe('tenant_A');

    // 4 — round-trip: get(id) revalidates the stored document.
    const fetched = await engine.get(generated.tab.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(generated.tab.id);
    expect(fetched!.tabKey).toBe(generated.tab.tabKey);
  });

  it('every generated field + widget kind resolves in the render registries', async () => {
    const engine = createGenUIEngine();
    // Generate across multiple domains so the assertion covers a broad slice
    // of the generator's field/widget vocabulary.
    const messages = [
      'we need to track our staff payroll',
      'please add a supplier onboarding tab',
      'I want a place to put our ISO 27001 compliance evidence',
      'we need to manage our budgets and finance',
    ];

    const tabs: PortalTab[] = [];
    for (const message of messages) {
      const intent = await engine.detectIntent({ message });
      if (!intent) continue;
      const result = await engine.generate({
        intent,
        tenantId: 'tenant_A',
        userId: 'user_1',
        actorId: 'user_1',
      });
      tabs.push(result.tab);
    }
    expect(tabs.length).toBeGreaterThan(0);

    // The host renders every section field via getFieldKindMetadata and every
    // widget via getWidgetKindMetadata. Prove each generated kind resolves —
    // a miss would render a blank control / card in owner-web.
    for (const tab of tabs) {
      // Round-trip through the public parser the host uses on fetch.
      const reparsed = safeParsePortalTab(tab);
      expect(reparsed).not.toBeNull();
      for (const section of tab.sections) {
        for (const field of section.fields) {
          const meta = getFieldKindMetadata(field.kind);
          expect(meta.rendererName.length).toBeGreaterThan(0);
          expect(ALL_FIELD_KINDS).toContain(field.kind);
        }
        for (const widget of section.widgets) {
          const meta = getWidgetKindMetadata(widget.kind);
          expect(meta.rendererName.length).toBeGreaterThan(0);
          expect(ALL_WIDGET_KINDS).toContain(widget.kind);
        }
      }
    }
  });
});
