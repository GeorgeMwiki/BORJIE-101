/**
 * Tests for the schema-evolution lane — proves a current-version spec passes
 * through and validates, a synthetic legacy shape is upgraded by a
 * test-registered migration, a future-version row fails LOUDLY (never silently
 * accepted or rotted), every fail-loud condition raises a typed
 * `PortalTabMigrationError`, and the migrator is pure / immutable.
 */

import { describe, expect, it } from 'vitest';
import { buildFallbackTab } from '../../generator/fallbacks.js';
import {
  PORTAL_TAB_SCHEMA_VERSION,
  type PortalTab,
  type TabGenerationIntent,
} from '../../types.js';
import {
  migratePortalTabRaw,
  verifyMigratable,
  PortalTabMigrationError,
  PORTAL_TAB_MIGRATIONS,
  type PortalTabMigrationStep,
} from '../migrate.js';

// ───────────────────────────────────────────────────────────────────
// Fixtures — reuse the canonical valid-tab factory so the fixture stays
// in lock-step with the real `PortalTabSchema`.
// ───────────────────────────────────────────────────────────────────

function mkTab(overrides: Partial<PortalTab> = {}): PortalTab {
  const intent: TabGenerationIntent = {
    proposedTabKey: 'hr.payroll',
    proposedTabTitle: 'Payroll',
    domain: 'hr',
    confidence: 0.8,
    evidence: [],
    sourceMessage: 's',
    usedLlm: false,
  };
  return {
    ...buildFallbackTab({
      intent,
      tenantId: 't1',
      userId: 'u1',
      actorId: 'system',
      nowIso: '2026-05-24T12:00:00.000Z',
      id: 'tab_a',
      sourceConversationId: undefined,
    }),
    ...overrides,
  };
}

/** The current valid tab, as a plain JSONB-ish record (version 1). */
const CURRENT_RAW = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(mkTab()));

describe('migratePortalTabRaw — current version passthrough', () => {
  it('passes a v1 raw spec through and validates it with PortalTabSchema', () => {
    const raw = CURRENT_RAW();
    const result = migratePortalTabRaw(raw);

    expect(result.fromVersion).toBe(PORTAL_TAB_SCHEMA_VERSION);
    expect(result.toVersion).toBe(PORTAL_TAB_SCHEMA_VERSION);
    expect(result.applied).toEqual([]);
    // The returned tab is the fully-parsed PortalTab.
    expect(result.tab.tabKey).toBe('hr.payroll');
    expect(result.tab.version).toBe(PORTAL_TAB_SCHEMA_VERSION);
  });

  it('throws POST_MIGRATION_INVALID when a current-version row is corrupt', () => {
    const raw = CURRENT_RAW();
    delete (raw as Record<string, unknown>).sections; // break a required field

    expect(() => migratePortalTabRaw(raw)).toThrowError(PortalTabMigrationError);
    try {
      migratePortalTabRaw(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(PortalTabMigrationError);
      expect((error as PortalTabMigrationError).code).toBe(
        'POST_MIGRATION_INVALID',
      );
    }
  });
});

describe('migratePortalTabRaw — legacy upgrade via test-registered migration', () => {
  // Simulate a world where the current version is 2 and a v1->v2 migration
  // exists. The synthetic legacy shape carries an extra `legacyTitle` that the
  // up-migration folds into `title` and drops, then bumps the version.
  const targetVersion = 2;
  const registry: ReadonlyArray<PortalTabMigrationStep> = [
    {
      from: 1,
      to: 2,
      describe: 'v1->v2: fold legacyTitle into title',
      up: (raw) => {
        const { legacyTitle, ...rest } = raw as Record<string, unknown> & {
          legacyTitle?: string;
        };
        return {
          ...rest,
          version: 2,
          ...(typeof legacyTitle === 'string' ? { title: legacyTitle } : {}),
        };
      },
    },
  ];

  it('upgrades a synthetic legacy shape and validates the result', () => {
    const legacy: Record<string, unknown> = {
      ...CURRENT_RAW(),
      version: 1,
      legacyTitle: 'Renamed Payroll',
    };
    // The schema pins `version` to the literal current value, so for this
    // synthetic-future test we relax it by validating against targetVersion 2
    // only if the schema would accept it. The fallback tab is version 1, so to
    // keep PortalTabSchema happy we assert the migration RAN and bumped the
    // version + applied the transform, independent of final parse.
    const verdict = verifyMigratable(legacy, { registry, targetVersion });

    // PortalTabSchema only accepts version === 1, so the post-migration parse
    // is expected to reject version 2 — but the lane must have RUN the step.
    // We prove the step ran by checking the failure is POST_MIGRATION (parse),
    // not UNMIGRATABLE (no step) or VERSION_TOO_NEW.
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('POST_MIGRATION_INVALID');
    expect(verdict.fromVersion).toBe(1);
  });

  it('applies the step in order and records the describe trace', () => {
    // Use a registry whose final step lands back on version 1 so the schema
    // accepts it — proving the chain WALK + applied[] trace end-to-end.
    const roundTrip: ReadonlyArray<PortalTabMigrationStep> = [
      {
        from: 0,
        to: 1,
        describe: 'v0->v1: stamp version + drop pre-release marker',
        up: (raw) => {
          const { preRelease, ...rest } = raw as Record<string, unknown> & {
            preRelease?: boolean;
          };
          return { ...rest, version: 1 };
        },
      },
    ];
    const legacy: Record<string, unknown> = {
      ...CURRENT_RAW(),
      version: 0,
      preRelease: true,
    };

    const result = migratePortalTabRaw(legacy, {
      registry: roundTrip,
      targetVersion: 1,
    });

    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);
    expect(result.applied).toEqual([
      'v0->v1: stamp version + drop pre-release marker',
    ]);
    expect(result.tab.version).toBe(1);
    // The pre-release marker is gone from the validated tab.
    expect('preRelease' in result.tab).toBe(false);
  });
});

describe('migratePortalTabRaw — fail loud, never silent', () => {
  it('throws VERSION_TOO_NEW for a far-future version', () => {
    const raw = { ...CURRENT_RAW(), version: 999 };
    try {
      migratePortalTabRaw(raw);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PortalTabMigrationError);
      const e = error as PortalTabMigrationError;
      expect(e.code).toBe('VERSION_TOO_NEW');
      expect(e.fromVersion).toBe(999);
      expect(e.toVersion).toBe(PORTAL_TAB_SCHEMA_VERSION);
    }
  });

  it('throws UNMIGRATABLE when no step bridges a gap to the target', () => {
    // version 0, target 2, but the registry only has a v1->v2 step → the
    // v0->v1 gap is unbridgeable and must fail loudly.
    const registry: ReadonlyArray<PortalTabMigrationStep> = [
      { from: 1, to: 2, describe: 'v1->v2', up: (raw) => ({ ...raw, version: 2 }) },
    ];
    const raw = { ...CURRENT_RAW(), version: 0 };
    try {
      migratePortalTabRaw(raw, { registry, targetVersion: 2 });
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PortalTabMigrationError);
      expect((error as PortalTabMigrationError).code).toBe('UNMIGRATABLE');
    }
  });

  it('throws INVALID_VERSION for a missing / non-integer version', () => {
    for (const bad of [
      { ...CURRENT_RAW(), version: undefined },
      { ...CURRENT_RAW(), version: 1.5 },
      { ...CURRENT_RAW(), version: '1' },
      'not-an-object',
      null,
    ]) {
      expect(() => migratePortalTabRaw(bad)).toThrowError(
        PortalTabMigrationError,
      );
      try {
        migratePortalTabRaw(bad);
      } catch (error) {
        expect((error as PortalTabMigrationError).code).toBe('INVALID_VERSION');
      }
    }
  });

  it('throws UNMIGRATABLE when a step leaves the wrong version', () => {
    const broken: ReadonlyArray<PortalTabMigrationStep> = [
      {
        from: 0,
        to: 1,
        describe: 'buggy: forgets to bump version',
        up: (raw) => ({ ...raw }), // never sets version → stays 0
      },
    ];
    const raw = { ...CURRENT_RAW(), version: 0 };
    try {
      migratePortalTabRaw(raw, { registry: broken, targetVersion: 1 });
      throw new Error('expected throw');
    } catch (error) {
      expect((error as PortalTabMigrationError).code).toBe('UNMIGRATABLE');
    }
  });
});

describe('migratePortalTabRaw — purity / immutability', () => {
  it('never mutates the input raw object', () => {
    const raw = { ...CURRENT_RAW(), version: 0, preRelease: true };
    const snapshot = JSON.stringify(raw);
    const registry: ReadonlyArray<PortalTabMigrationStep> = [
      {
        from: 0,
        to: 1,
        describe: 'v0->v1',
        up: (r) => {
          const { preRelease, ...rest } = r as Record<string, unknown>;
          return { ...rest, version: 1 };
        },
      },
    ];
    migratePortalTabRaw(raw, { registry, targetVersion: 1 });
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it('returns a frozen applied[] trace', () => {
    const result = migratePortalTabRaw(CURRENT_RAW());
    expect(Object.isFrozen(result.applied)).toBe(true);
  });
});

describe('PORTAL_TAB_MIGRATIONS registry', () => {
  it('is frozen and every step bumps version by exactly one', () => {
    expect(Object.isFrozen(PORTAL_TAB_MIGRATIONS)).toBe(true);
    for (const step of PORTAL_TAB_MIGRATIONS) {
      expect(step.to).toBe(step.from + 1);
      expect(typeof step.describe).toBe('string');
      expect(step.describe.length).toBeGreaterThan(0);
    }
  });

  it('the no-op v0->v1 entry stamps version 1', () => {
    const v0v1 = PORTAL_TAB_MIGRATIONS.find((s) => s.from === 0);
    expect(v0v1).toBeDefined();
    const out = v0v1!.up({ version: 0, foo: 'bar' });
    expect(out.version).toBe(1);
    expect(out.foo).toBe('bar');
  });
});

describe('verifyMigratable', () => {
  it('returns ok:true for a current-version spec', () => {
    const verdict = verifyMigratable(CURRENT_RAW());
    expect(verdict.ok).toBe(true);
    expect(verdict.fromVersion).toBe(PORTAL_TAB_SCHEMA_VERSION);
    expect(verdict.toVersion).toBe(PORTAL_TAB_SCHEMA_VERSION);
  });

  it('returns ok:false with the code+reason for a future-version spec', () => {
    const verdict = verifyMigratable({ ...CURRENT_RAW(), version: 999 });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('VERSION_TOO_NEW');
    expect(verdict.fromVersion).toBe(999);
    expect(verdict.reason).toContain('newer');
  });

  it('returns ok:false (INVALID_VERSION) without throwing for garbage input', () => {
    const verdict = verifyMigratable({ no: 'version' });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('INVALID_VERSION');
  });
});
