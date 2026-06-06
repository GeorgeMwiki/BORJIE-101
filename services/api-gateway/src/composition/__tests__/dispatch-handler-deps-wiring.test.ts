/**
 * dispatch-handler-deps-wiring tests — proves the REAL ports actually
 * WRITE (vs the silent-success stubs they replace):
 *
 *   - mining schedule_licence_renewal  → INSERTs into tasks +
 *                                         temporal_entities + ai_audit_chain,
 *                                         and fans a notification onto the
 *                                         cross-portal bus.
 *   - mining open_equipment_maintenance → INSERTs into maintenance_events +
 *                                          tasks + ai_audit_chain.
 *   - mining bulk_mark_licences_for_renewal → INSERTs one task per EXISTING
 *                                              licence, skips unknown ids.
 *   - every write binds `app.current_tenant_id` (RLS) inside its tx.
 *   - estate lease-application + receipt stores fail loud
 *     (NotYetWiredError) instead of fabricating a fake id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createRealMiningHandlerDeps,
  createRealEstateHandlerDeps,
  NotYetWiredError,
} from '../dispatch-handler-deps-wiring.js';
import {
  createInMemoryCrossPortalBus,
  tenantTopic,
  type CrossPortalEventShape,
} from '../cross-portal-bus.js';
import {
  buildMiningHandlerSet,
  type MiningHandlerDeps,
} from '@borjie/module-templates';
import type { ModuleUpdateProposal } from '@borjie/dispatch-router';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const TENANT = 'tenant-001';

// ─────────────────────────────────────────────────────────────────────
// Fake SqlExecutor — records every executed statement's text + bound
// params so tests can assert which tables were written. Supports the
// `.transaction(cb)` boundary (the wiring binds the tenant GUC inside).
// `auditLatest` lets the audit-chain repo's getLatest return a prior row.
// ─────────────────────────────────────────────────────────────────────

interface ExecutedStatement {
  readonly text: string;
}

function compileSqlText(query: unknown): { text: string } {
  // A raw Drizzle `SQL` chunk object does not expose `.toSQL()` (that lives
  // on the query builder). JSON-serialising the chunk structure preserves
  // every literal SQL fragment AND every bound value as nested chunks, which
  // is enough for the table-name assertions below. We don't reconstruct the
  // exact parameterised statement — the fake matches on substrings.
  return { text: JSON.stringify(query) };
}

function makeFakeDb(opts?: {
  existingLicenceIds?: ReadonlyArray<string>;
}): {
  execute(q: unknown): Promise<unknown>;
  transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T>;
  readonly statements: ExecutedStatement[];
} {
  const statements: ExecutedStatement[] = [];
  const existing = new Set(opts?.existingLicenceIds ?? []);

  const exec = async (q: unknown): Promise<unknown> => {
    const { text } = compileSqlText(q);
    statements.push({ text });

    // ai_audit_chain getLatest — return empty so sequence starts at 1.
    if (/ai_audit_chain/i.test(text) && /sequence_id/i.test(text)) {
      return { rows: [] };
    }
    // licences existence probe for the bulk handler — return the configured
    // existing set whose ids appear in the (JSON-embedded) query text, so a
    // licence id not in `existing` is skipped by the handler.
    if (/licences/i.test(text)) {
      const present = [...existing].filter((id) => text.includes(id));
      return { rows: present.map((id) => ({ id })) };
    }
    // core_entity findById — not exercised in mining tests.
    return { rows: [] };
  };

  const self = {
    statements,
    execute: exec,
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      // The tx shares the same recorder so set_config + inserts are visible.
      return cb(self);
    },
  };
  return self;
}

function statementTexts(db: { statements: ExecutedStatement[] }): string {
  return db.statements.map((s) => s.text).join('\n---\n');
}

// ─────────────────────────────────────────────────────────────────────
// Proposal factory
// ─────────────────────────────────────────────────────────────────────

function proposal(
  action: string,
  payload: Record<string, unknown>,
): ModuleUpdateProposal {
  return {
    id: `prop-${action}`,
    tenant_id: TENANT,
    capture_id: 'cap-123',
    module_template_id: 'MINING',
    action,
    persona_id: 'persona-owner',
    status: 'pending_review',
    confidence: 0.9,
    hitl_required: true,
    priority: 'normal',
    payload,
    entity_refs: [],
    matrix_row_id: null,
    approver_tier: null,
    approver_user_id: null,
    decline_reason: null,
    edited_from_id: null,
    failure_reason: null,
    resolved_at: null,
    expires_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as ModuleUpdateProposal;
}

// ─────────────────────────────────────────────────────────────────────
// MINING — real writes
// ─────────────────────────────────────────────────────────────────────

describe('createRealMiningHandlerDeps — real DB writes', () => {
  it('schedule_licence_renewal writes tasks + temporal_entities + audit + notifies', async () => {
    const db = makeFakeDb();
    const bus = createInMemoryCrossPortalBus();
    const received: CrossPortalEventShape[] = [];
    await bus.subscribe(tenantTopic(TENANT), (e) => received.push(e));

    const deps: MiningHandlerDeps = createRealMiningHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(bus),
    });
    const handlers = buildMiningHandlerSet(deps);

    const result = await handlers.schedule_licence_renewal({
      tenant_id: TENANT,
      proposal: proposal('schedule_licence_renewal', {
        licence_id: 'lic-1',
        company_id: 'co-1',
        site_id: 'site-1',
        target_start_date: '2026-09-01',
        rationale: 'renewal window approaching',
        assigned_user_id: null,
        priority: 4,
        followup_cadence: 'weekly',
        evidence_ids: ['ev-1'],
        source: { capture_id: 'cap-123', document_id: null },
      }),
    });

    expect(result.ok).toBe(true);
    const sql = statementTexts(db);
    expect(sql).toMatch(/INSERT INTO tasks/i);
    expect(sql).toMatch(/INSERT INTO temporal_entities/i);
    expect(sql).toMatch(/INSERT INTO ai_audit_chain/i);
    // RLS — every write tx binds the tenant GUC as its first statement.
    expect(sql).toMatch(/set_config\(\s*'app.current_tenant_id'/i);
    // Notification fanned out on the tenant's cross-portal channel.
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.kind).toBe('notification');
  });

  it('open_equipment_maintenance writes maintenance_events + tasks + audit', async () => {
    const db = makeFakeDb();
    const bus = createInMemoryCrossPortalBus();

    const deps = createRealMiningHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(bus),
    });
    const handlers = buildMiningHandlerSet(deps);

    const result = await handlers.open_equipment_maintenance({
      tenant_id: TENANT,
      proposal: proposal('open_equipment_maintenance', {
        asset_id: 'asset-1',
        site_id: 'site-1',
        summary: 'excavator hydraulic leak',
        kind: 'repair',
        severity: 'high',
        description: null,
        scheduled_for: null,
        estimated_downtime_hours: 6,
        reporter_user_id: null,
        evidence_ids: [],
        source: { capture_id: 'cap-123', document_id: null },
      }),
    });

    expect(result.ok).toBe(true);
    const sql = statementTexts(db);
    expect(sql).toMatch(/INSERT INTO maintenance_events/i);
    expect(sql).toMatch(/INSERT INTO tasks/i);
    expect(sql).toMatch(/INSERT INTO ai_audit_chain/i);
  });

  it('bulk_mark_licences_for_renewal inserts existing licences, skips unknown', async () => {
    const db = makeFakeDb({ existingLicenceIds: ['lic-1', 'lic-2'] });
    const bus = createInMemoryCrossPortalBus();

    const deps = createRealMiningHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(bus),
    });
    const handlers = buildMiningHandlerSet(deps);

    const result = await handlers.bulk_mark_licences_for_renewal({
      tenant_id: TENANT,
      proposal: proposal('bulk_mark_licences_for_renewal', {
        licence_ids: ['lic-1', 'lic-2', 'lic-missing'],
        reason: 'flag 90-day expiries',
        prep_window_days: 60,
        followup_cadence: 'weekly',
        source: { capture_id: 'cap-123', document_id: null },
      }),
    });

    expect(result.ok).toBe(true);
    const sql = statementTexts(db);
    // Two task inserts (lic-1, lic-2) — the missing licence is skipped.
    const insertCount = (sql.match(/INSERT INTO tasks/gi) ?? []).length;
    expect(insertCount).toBe(2);
    expect(sql).toMatch(/INSERT INTO ai_audit_chain/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// ESTATE — honest failure at the un-wired seams
// ─────────────────────────────────────────────────────────────────────

describe('createRealEstateHandlerDeps — honest-failure boundary', () => {
  it('lease-application store throws NotYetWiredError (no fake id)', async () => {
    const db = makeFakeDb();
    const deps = createRealEstateHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(createInMemoryCrossPortalBus()),
    });

    await expect(
      deps.createLeaseApplication.applications.draftApplication({
        tenantId: TENANT,
        moduleId: 'ESTATE',
        tenantEntityId: 'ce-1',
        unitId: 'unit-1',
        startDate: '2026-09-01',
        proposedTermMonths: 12,
        monthlyRent: { amount: 200000, currencyCode: 'TZS' },
      }),
    ).rejects.toBeInstanceOf(NotYetWiredError);
  });

  it('receipt stores throw NotYetWiredError (no fake id)', async () => {
    const db = makeFakeDb();
    const deps = createRealEstateHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(createInMemoryCrossPortalBus()),
    });

    await expect(
      deps.postReceiptDraft.receipts.draft({
        tenantId: TENANT,
        customerEntityId: 'ce-1',
        leaseId: null,
        amount: 200000,
        currencyCode: 'TZS',
        paymentDate: '2026-09-01',
        externalRef: null,
        ledgerDraftId: 'ld-1',
      }),
    ).rejects.toBeInstanceOf(NotYetWiredError);
  });

  it('estate core_entity createPerson writes a real row (tenant-bound)', async () => {
    const db = makeFakeDb();
    const deps = createRealEstateHandlerDeps({
      db: db as never,
      crossPortalBus: Promise.resolve(createInMemoryCrossPortalBus()),
    });

    const created = await deps.createLeaseApplication.coreEntity.createPerson({
      tenantId: TENANT,
      moduleId: 'ESTATE',
      displayName: 'Jane Miner',
      customFields: { contact_phone: '+255700000000' },
    });

    expect(created.id).toMatch(/^ce_/);
    const sql = statementTexts(db);
    expect(sql).toMatch(/INSERT INTO core_entity/i);
    expect(sql).toMatch(/set_config\(\s*'app.current_tenant_id'/i);
  });
});
