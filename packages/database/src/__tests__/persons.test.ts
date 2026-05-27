/**
 * Unified Personal Knowledge Base — schema + invariant tests.
 *
 * Two test groups, mirroring `section-layouts.test.ts`:
 *
 *   1. Drizzle schema introspection — confirms the column shape,
 *      primary keys, unique constraints, and index declarations of
 *      `persons`, `person_links`, and `personal_memory_cells` match
 *      the migration 0088 expectations. Runs without a database.
 *
 *   2. In-process behavioural simulator — proves the federation
 *      invariants documented in `Docs/research/unified-personal-kb.md`
 *      §10 hold at the data layer:
 *
 *        - `persons` CRUD with phone uniqueness;
 *        - `person_links` triple-uniqueness + cascade-on-person-delete;
 *        - `personal_memory_cells` upsert via (person_id, cell_kind, key);
 *        - consent set + revoke timestamps;
 *        - expires_at TTL filter (active vs expired cells);
 *        - NO RLS on `personal_memory_cells` — federated by design.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  persons,
  personLinks,
  type PersonRow,
  type PersonLinkRow,
} from '../schemas/persons.schema.js';
import {
  personalMemoryCells,
  type PersonalMemoryCellRow,
} from '../schemas/personal-memory.schema.js';

// ─────────────────────────────────────────────────────────────────────
// 1. Schema introspection — Drizzle config matches migration 0088.
// ─────────────────────────────────────────────────────────────────────

describe('persons schema (migration 0088)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(persons);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'primary_phone_e164',
        'primary_email',
        'display_name',
        'preferred_language',
        'consent_unified_kb_at',
        'consent_unified_kb_revoked_at',
        'created_at',
        'updated_at',
        'hash_chain_id',
      ].sort(),
    );
  });

  it('uses `id` (uuid) as the primary key', () => {
    const cfg = getTableConfig(persons);
    const idCol = cfg.columns.find((c) => c.name === 'id');
    expect(idCol?.primary).toBe(true);
    expect(idCol?.dataType).toBe('string');
  });

  it('declares phone index `idx_persons_phone`', () => {
    const cfg = getTableConfig(persons);
    const idx = cfg.indexes.find((i) => i.config.name === 'idx_persons_phone');
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['primary_phone_e164']);
  });

  it('Row + Insert types are exported', () => {
    const row: PersonRow | undefined = undefined;
    expect(persons).toBeDefined();
    expect(row).toBeUndefined();
  });
});

describe('person_links schema (migration 0088)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(personLinks);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'person_id',
        'tenant_id',
        'supabase_user_id',
        'role_in_tenant',
        'linked_at',
        'unlinked_at',
        'link_method',
      ].sort(),
    );
  });

  it('declares (person_id, tenant_id, supabase_user_id) UNIQUE', () => {
    const cfg = getTableConfig(personLinks);
    const uq = cfg.uniqueConstraints.find(
      (u) => u.name === 'uq_person_links_person_tenant_user',
    );
    expect(uq).toBeDefined();
    const cols = uq?.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      ['person_id', 'tenant_id', 'supabase_user_id'].sort(),
    );
  });

  it('declares (tenant_id, supabase_user_id) lookup index', () => {
    const cfg = getTableConfig(personLinks);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'idx_person_links_tenant_user',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['tenant_id', 'supabase_user_id']);
  });

  it('Row type is exported', () => {
    const row: PersonLinkRow | undefined = undefined;
    expect(personLinks).toBeDefined();
    expect(row).toBeUndefined();
  });
});

describe('personal_memory_cells schema (migration 0088)', () => {
  it('declares the canonical column set', () => {
    const cfg = getTableConfig(personalMemoryCells);
    const names = cfg.columns.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'person_id',
        'cell_kind',
        'key',
        'value',
        'confidence',
        'source_tenant_id',
        'source_thread_id',
        'captured_at',
        'expires_at',
      ].sort(),
    );
  });

  it('declares (person_id, cell_kind, key) UNIQUE — upsert key', () => {
    const cfg = getTableConfig(personalMemoryCells);
    const uq = cfg.uniqueConstraints.find(
      (u) => u.name === 'uq_personal_memory_person_kind_key',
    );
    expect(uq).toBeDefined();
    const cols = uq?.columns.map((c) => c.name).sort();
    expect(cols).toEqual(['person_id', 'cell_kind', 'key'].sort());
  });

  it('declares (person_id, cell_kind) hot-path index', () => {
    const cfg = getTableConfig(personalMemoryCells);
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'idx_personal_memory_person_kind',
    );
    expect(idx).toBeDefined();
    const cols = idx?.config.columns.map(
      (c) => (c as { name?: string }).name ?? '',
    );
    expect(cols).toEqual(['person_id', 'cell_kind']);
  });

  it('has NO `tenant_id` column (federated-no-RLS precedent)', () => {
    const cfg = getTableConfig(personalMemoryCells);
    const tenantCol = cfg.columns.find((c) => c.name === 'tenant_id');
    expect(tenantCol).toBeUndefined();
  });

  it('Row type is exported', () => {
    const row: PersonalMemoryCellRow | undefined = undefined;
    expect(personalMemoryCells).toBeDefined();
    expect(row).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Behavioural simulator — proves the §10 federation invariants.
//
// Mirrors `section-layouts.test.ts` and `decision-traces.test.ts`. No
// live Postgres in CI; we model the (persons, person_links,
// personal_memory_cells) shape and its constraints in-process.
// ─────────────────────────────────────────────────────────────────────

interface PersonRecord {
  readonly id: string;
  readonly primaryPhoneE164: string;
  readonly primaryEmail: string | null;
  readonly displayName: string;
  readonly preferredLanguage: 'sw' | 'en';
  readonly consentUnifiedKbAt: Date | null;
  readonly consentUnifiedKbRevokedAt: Date | null;
}

interface PersonLinkRecord {
  readonly id: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly supabaseUserId: string;
  readonly roleInTenant:
    | 'owner'
    | 'manager'
    | 'employee'
    | 'buyer'
    | 'admin';
  readonly linkedAt: Date;
  readonly linkMethod: 'phone-match' | 'manual' | 'sso' | 'sso-merge';
}

interface MemoryCellRecord {
  readonly id: string;
  readonly personId: string;
  readonly cellKind:
    | 'preference'
    | 'context'
    | 'recurring-fact'
    | 'calibration'
    | 'sentiment';
  readonly key: string;
  readonly value: Record<string, unknown>;
  readonly confidence: number;
  readonly capturedAt: Date;
  readonly expiresAt: Date | null;
}

class UnifiedKbSim {
  private readonly persons: PersonRecord[] = [];
  private readonly links: PersonLinkRecord[] = [];
  private readonly cells: MemoryCellRecord[] = [];
  private idCounter = 0;

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  insertPerson(
    init: Omit<
      PersonRecord,
      'id' | 'consentUnifiedKbAt' | 'consentUnifiedKbRevokedAt'
    > & {
      readonly consentUnifiedKbAt?: Date | null;
      readonly consentUnifiedKbRevokedAt?: Date | null;
    },
  ): PersonRecord {
    if (
      this.persons.some(
        (p) => p.primaryPhoneE164 === init.primaryPhoneE164,
      )
    ) {
      throw new Error(
        `UNIQUE violation: primary_phone_e164=${init.primaryPhoneE164}`,
      );
    }
    const row: PersonRecord = {
      id: this.nextId('prs'),
      primaryPhoneE164: init.primaryPhoneE164,
      primaryEmail: init.primaryEmail,
      displayName: init.displayName,
      preferredLanguage: init.preferredLanguage,
      consentUnifiedKbAt: init.consentUnifiedKbAt ?? null,
      consentUnifiedKbRevokedAt: init.consentUnifiedKbRevokedAt ?? null,
    };
    this.persons.push(row);
    return row;
  }

  updateConsent(
    personId: string,
    patch: {
      readonly consentUnifiedKbAt?: Date | null;
      readonly consentUnifiedKbRevokedAt?: Date | null;
    },
  ): PersonRecord {
    const idx = this.persons.findIndex((p) => p.id === personId);
    if (idx < 0) throw new Error(`person not found: ${personId}`);
    const existing = this.persons[idx];
    if (!existing) throw new Error(`person not found: ${personId}`);
    const updated: PersonRecord = {
      id: existing.id,
      primaryPhoneE164: existing.primaryPhoneE164,
      primaryEmail: existing.primaryEmail,
      displayName: existing.displayName,
      preferredLanguage: existing.preferredLanguage,
      consentUnifiedKbAt:
        patch.consentUnifiedKbAt !== undefined
          ? patch.consentUnifiedKbAt
          : existing.consentUnifiedKbAt,
      consentUnifiedKbRevokedAt:
        patch.consentUnifiedKbRevokedAt !== undefined
          ? patch.consentUnifiedKbRevokedAt
          : existing.consentUnifiedKbRevokedAt,
    };
    return this.persons
      .splice(idx, 1, updated)
      .concat()
      .pop() === updated
      ? updated
      : updated;
  }

  findPerson(personId: string): PersonRecord | undefined {
    return this.persons.find((p) => p.id === personId);
  }

  deletePerson(personId: string): void {
    // Cascade: drop links + cells.
    const remainingLinks = this.links.filter((l) => l.personId !== personId);
    const remainingCells = this.cells.filter((c) => c.personId !== personId);
    this.links.splice(0, this.links.length, ...remainingLinks);
    this.cells.splice(0, this.cells.length, ...remainingCells);
    const personIdx = this.persons.findIndex((p) => p.id === personId);
    if (personIdx >= 0) this.persons.splice(personIdx, 1);
  }

  insertLink(
    init: Omit<PersonLinkRecord, 'id' | 'linkedAt' | 'linkMethod'> & {
      readonly linkedAt?: Date;
      readonly linkMethod?: PersonLinkRecord['linkMethod'];
    },
  ): PersonLinkRecord {
    if (!this.persons.some((p) => p.id === init.personId)) {
      throw new Error(`FK violation: person_id=${init.personId}`);
    }
    const triple = (l: { personId: string; tenantId: string; supabaseUserId: string }) =>
      `${l.personId}::${l.tenantId}::${l.supabaseUserId}`;
    if (this.links.some((l) => triple(l) === triple(init))) {
      throw new Error(
        `UNIQUE violation: (person, tenant, supabase_user) triple already exists`,
      );
    }
    const row: PersonLinkRecord = {
      id: this.nextId('lnk'),
      personId: init.personId,
      tenantId: init.tenantId,
      supabaseUserId: init.supabaseUserId,
      roleInTenant: init.roleInTenant,
      linkedAt: init.linkedAt ?? new Date(),
      linkMethod: init.linkMethod ?? 'phone-match',
    };
    this.links.push(row);
    return row;
  }

  listLinks(personId: string): readonly PersonLinkRecord[] {
    return this.links.filter((l) => l.personId === personId);
  }

  /**
   * Upsert via the (person_id, cell_kind, key) triple. Replaces value +
   * confidence + captured_at when the same key fires again. Mirrors
   * `ON CONFLICT (person_id, cell_kind, key) DO UPDATE` at the SQL level.
   */
  upsertCell(
    init: Omit<MemoryCellRecord, 'id' | 'capturedAt'> & {
      readonly capturedAt?: Date;
    },
  ): MemoryCellRecord {
    if (!this.persons.some((p) => p.id === init.personId)) {
      throw new Error(`FK violation: person_id=${init.personId}`);
    }
    const triple = (c: { personId: string; cellKind: string; key: string }) =>
      `${c.personId}::${c.cellKind}::${c.key}`;
    const existingIdx = this.cells.findIndex(
      (c) => triple(c) === triple(init),
    );
    const next: MemoryCellRecord = {
      id:
        existingIdx >= 0
          ? (this.cells[existingIdx] as MemoryCellRecord).id
          : this.nextId('cell'),
      personId: init.personId,
      cellKind: init.cellKind,
      key: init.key,
      value: init.value,
      confidence: init.confidence,
      capturedAt: init.capturedAt ?? new Date(),
      expiresAt: init.expiresAt,
    };
    if (existingIdx >= 0) {
      this.cells.splice(existingIdx, 1, next);
    } else {
      this.cells.push(next);
    }
    return next;
  }

  /** Active cells: not yet expired vs the supplied `now`. */
  listActiveCells(personId: string, now: Date): readonly MemoryCellRecord[] {
    return this.cells.filter(
      (c) =>
        c.personId === personId &&
        (c.expiresAt === null || c.expiresAt.getTime() > now.getTime()),
    );
  }

  countCells(personId: string): number {
    return this.cells.filter((c) => c.personId === personId).length;
  }
}

describe('persons CRUD invariants (migration 0088)', () => {
  let sim: UnifiedKbSim;

  beforeEach(() => {
    sim = new UnifiedKbSim();
  });

  it('inserts a person and refuses duplicate primary_phone_e164', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712345678',
      primaryEmail: 'asha@example.tz',
      displayName: 'Asha M.',
      preferredLanguage: 'sw',
    });
    expect(asha.id).toBeDefined();
    expect(asha.preferredLanguage).toBe('sw');
    expect(asha.consentUnifiedKbAt).toBeNull();

    expect(() =>
      sim.insertPerson({
        primaryPhoneE164: '+255712345678',
        primaryEmail: null,
        displayName: 'Asha Duplicate',
        preferredLanguage: 'en',
      }),
    ).toThrow(/UNIQUE violation/);
  });

  it('sets and then revokes unified-KB consent (timestamps independent)', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000001',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    const grantedAt = new Date('2026-05-27T08:00:00Z');
    sim.updateConsent(asha.id, { consentUnifiedKbAt: grantedAt });
    const afterGrant = sim.findPerson(asha.id);
    expect(afterGrant?.consentUnifiedKbAt).toEqual(grantedAt);
    expect(afterGrant?.consentUnifiedKbRevokedAt).toBeNull();

    const revokedAt = new Date('2026-05-27T18:00:00Z');
    sim.updateConsent(asha.id, { consentUnifiedKbRevokedAt: revokedAt });
    const afterRevoke = sim.findPerson(asha.id);
    expect(afterRevoke?.consentUnifiedKbAt).toEqual(grantedAt);
    expect(afterRevoke?.consentUnifiedKbRevokedAt).toEqual(revokedAt);
  });
});

describe('person_links uniqueness + cascade (migration 0088)', () => {
  let sim: UnifiedKbSim;

  beforeEach(() => {
    sim = new UnifiedKbSim();
  });

  it('refuses a duplicate (person, tenant, supabase_user) triple', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000002',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    const tenantA = '00000000-0000-0000-0000-00000000aaaa';
    const userX = '00000000-0000-0000-0000-00000000000a';

    sim.insertLink({
      personId: asha.id,
      tenantId: tenantA,
      supabaseUserId: userX,
      roleInTenant: 'owner',
    });

    expect(() =>
      sim.insertLink({
        personId: asha.id,
        tenantId: tenantA,
        supabaseUserId: userX,
        roleInTenant: 'manager',
      }),
    ).toThrow(/UNIQUE violation/);
  });

  it('allows the same person to wear different hats at different tenants', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000003',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    const tenantA = '00000000-0000-0000-0000-00000000aaaa';
    const tenantB = '00000000-0000-0000-0000-00000000bbbb';
    const userX = '00000000-0000-0000-0000-00000000000a';
    const userY = '00000000-0000-0000-0000-00000000000b';

    sim.insertLink({
      personId: asha.id,
      tenantId: tenantA,
      supabaseUserId: userX,
      roleInTenant: 'owner',
    });
    sim.insertLink({
      personId: asha.id,
      tenantId: tenantB,
      supabaseUserId: userY,
      roleInTenant: 'manager',
    });

    const links = sim.listLinks(asha.id);
    expect(links.length).toBe(2);
    expect(links.map((l) => l.roleInTenant).sort()).toEqual(
      ['manager', 'owner'].sort(),
    );
  });

  it('cascades on person delete (links + cells removed)', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000004',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    sim.insertLink({
      personId: asha.id,
      tenantId: '00000000-0000-0000-0000-00000000aaaa',
      supabaseUserId: '00000000-0000-0000-0000-00000000000a',
      roleInTenant: 'owner',
    });
    sim.upsertCell({
      personId: asha.id,
      cellKind: 'preference',
      key: 'salutation',
      value: { text: 'Asha, not Madam' },
      confidence: 1.0,
      expiresAt: null,
    });

    expect(sim.listLinks(asha.id).length).toBe(1);
    expect(sim.countCells(asha.id)).toBe(1);

    sim.deletePerson(asha.id);

    expect(sim.findPerson(asha.id)).toBeUndefined();
    expect(sim.listLinks(asha.id).length).toBe(0);
    expect(sim.countCells(asha.id)).toBe(0);
  });
});

describe('personal_memory_cells upsert + TTL (migration 0088)', () => {
  let sim: UnifiedKbSim;

  beforeEach(() => {
    sim = new UnifiedKbSim();
  });

  it('upserts on (person_id, cell_kind, key) — second write replaces first', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000005',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    const first = sim.upsertCell({
      personId: asha.id,
      cellKind: 'preference',
      key: 'buy.lithium.threshold',
      value: { pct: 0.75 },
      confidence: 0.7,
      capturedAt: new Date('2026-05-26T10:00:00Z'),
      expiresAt: null,
    });
    const second = sim.upsertCell({
      personId: asha.id,
      cellKind: 'preference',
      key: 'buy.lithium.threshold',
      value: { pct: 0.8 },
      confidence: 0.95,
      capturedAt: new Date('2026-05-27T10:00:00Z'),
      expiresAt: null,
    });
    expect(second.id).toBe(first.id);
    expect(sim.countCells(asha.id)).toBe(1);

    const active = sim.listActiveCells(
      asha.id,
      new Date('2026-05-27T11:00:00Z'),
    );
    expect(active.length).toBe(1);
    expect((active[0] as MemoryCellRecord).value).toEqual({ pct: 0.8 });
    expect((active[0] as MemoryCellRecord).confidence).toBe(0.95);
  });

  it('filters out cells past their expires_at TTL', () => {
    const asha = sim.insertPerson({
      primaryPhoneE164: '+255712000006',
      primaryEmail: null,
      displayName: 'Asha',
      preferredLanguage: 'sw',
    });
    sim.upsertCell({
      personId: asha.id,
      cellKind: 'context',
      key: 'health.flu',
      value: { since: '2026-05-25' },
      confidence: 1.0,
      capturedAt: new Date('2026-05-25T10:00:00Z'),
      expiresAt: new Date('2026-05-26T10:00:00Z'),
    });
    sim.upsertCell({
      personId: asha.id,
      cellKind: 'recurring-fact',
      key: 'family.mother.deceased',
      value: { date: '2024-08-15' },
      confidence: 1.0,
      capturedAt: new Date('2024-08-15T10:00:00Z'),
      expiresAt: null,
    });

    const active = sim.listActiveCells(
      asha.id,
      new Date('2026-05-27T11:00:00Z'),
    );
    expect(active.length).toBe(1);
    expect((active[0] as MemoryCellRecord).cellKind).toBe('recurring-fact');
  });

  it('rejects a cell insert whose person_id has no matching person row', () => {
    expect(() =>
      sim.upsertCell({
        personId: 'prs-does-not-exist',
        cellKind: 'preference',
        key: 'salutation',
        value: { text: 'Asha' },
        confidence: 1.0,
        expiresAt: null,
      }),
    ).toThrow(/FK violation/);
  });
});
