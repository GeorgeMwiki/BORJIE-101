/**
 * Schema-valid `PortalTab` spec generator for the exhaustiveness proof.
 *
 * Law 1 says: every schema-valid spec is safe — validity implies no-throw
 * through the pure renderers/normalizers. To PROVE that we need a generator
 * that, fed a seed, emits a spec which is in-bounds BY CONSTRUCTION (so
 * `PortalTabSchema.parse` accepts it) yet varies aggressively across the closed
 * catalogs: every `PortalTabFieldKind`, every `PortalTabWidgetKind`, random
 * section / field / widget counts, and edge sizes pinned at the schema bounds.
 *
 * The generator is driven entirely by the seeded `Prng` (`./prng.ts`) — no
 * clock, no `Math.random` — so each seed reproduces one exact spec. It is pure
 * and immutable: it only ever constructs and returns fresh objects.
 *
 * Coverage handle: every kind a generated spec touches is recorded through the
 * injected `markFieldKind` / `markWidgetKind` sinks, so the test can assert the
 * union over all seeds EQUALS the catalog set (an unhandled future kind would
 * leave the covered-set short and fail the proof).
 *
 * @module @borjie/portal-genui/totality/spec-generator
 */

import {
  PORTAL_TAB_FIELD_KINDS,
  PORTAL_TAB_WIDGET_KINDS,
  PORTAL_DASHBOARD_KIND_NAMES,
  PORTAL_LOCALES,
  type PortalTab,
  type PortalTabField,
  type PortalTabFieldKind,
  type PortalTabSection,
  type PortalTabWidget,
  type PortalTabWidgetKind,
  PORTAL_TAB_SCHEMA_VERSION,
} from '../types.js';
import {
  PORTAL_QUERY_RESOURCES,
  PORTAL_TOOL_IDS,
} from '../capabilities/registry.js';
import type { Prng } from './prng.js';

const DOMAINS = [
  'hr',
  'finance',
  'compliance',
  'procurement',
  'operations',
  'sales',
  'marketing',
  'engineering',
  'legal',
  'sustainability',
  'custom',
] as const;

const PERSONAS = [
  'internal_admin',
  'property_manager',
  'estate_manager',
  'owner',
  'customer',
] as const;

/** Sinks the test injects to record which kinds a spec exercised. */
export interface CoverageSinks {
  readonly markFieldKind: (kind: PortalTabFieldKind) => void;
  readonly markWidgetKind: (kind: PortalTabWidgetKind) => void;
}

/**
 * Per-spec knobs. `forceFieldKind` / `forceWidgetKind` let the test PIN a
 * specific kind into a spec so coverage of every catalog entry is guaranteed
 * (rather than left to chance), while the rest of the spec stays randomized.
 */
export interface SpecGenOptions {
  readonly forceFieldKind?: PortalTabFieldKind;
  readonly forceWidgetKind?: PortalTabWidgetKind;
}

const ISO_SAMPLES = [
  '2026-01-01T00:00:00.000Z',
  '2026-05-24T09:30:00.000Z',
  '2026-12-31T23:59:59.000Z',
] as const;

/** A short, schema-legal lowercase token for keys (`^[a-z][a-z0-9._-]*$`). */
function token(rng: Prng, prefix: string): string {
  return `${prefix}${rng.int(0, 9999).toString(36)}`;
}

/** A non-empty display label within the 1..200 bound. */
function label(rng: Prng, prefix: string): string {
  const n = rng.int(1, 3);
  return `${prefix} ${'x'.repeat(n)}`.slice(0, 200);
}

/**
 * Build a single field of an exact kind, with kind-specific knobs at their
 * schema bounds chosen at random (e.g. `options` for dropdown, `min`/`max` for
 * numerics, `accept` for uploads). Always in-bounds by construction.
 */
function buildField(
  rng: Prng,
  kind: PortalTabFieldKind,
  key: string,
): PortalTabField {
  const base: PortalTabField = {
    key,
    label: label(rng, 'F'),
    kind,
  };

  const optional: Partial<PortalTabField> = {};
  if (rng.bool(0.4)) optional.help = label(rng, 'help');
  if (rng.bool(0.5)) optional.required = rng.bool();
  if (rng.bool(0.3)) optional.readonly = rng.bool();
  if (rng.bool(0.3)) optional.hiddenInList = rng.bool();
  // span at the 1..12 edges sometimes.
  if (rng.bool(0.5)) optional.span = rng.pick([1, 6, 12]);
  if (rng.bool(0.3)) optional.placeholder = label(rng, 'ph');

  if (kind === 'dropdown' || kind === 'multi_select') {
    const count = rng.int(1, 4);
    optional.options = Array.from({ length: count }, (_, i) => ({
      value: token(rng, `opt${i}_`),
      label: label(rng, 'O'),
    }));
  }

  if (kind === 'number' || kind === 'currency' || kind === 'percent' || kind === 'rating') {
    if (rng.bool(0.5)) optional.min = rng.int(0, 5);
    if (rng.bool(0.5)) optional.max = rng.int(6, 100);
    if (rng.bool(0.5)) optional.precision = rng.int(0, 8); // schema bound 0..8
  }

  if (kind === 'currency' && rng.bool(0.6)) {
    optional.currencyCode = rng.pick(['TZS', 'USD', 'KES', 'UGX', 'NGN']);
  }

  if (kind === 'file_upload' || kind === 'image_upload' || kind === 'audio_note') {
    if (rng.bool(0.6)) {
      optional.accept = [rng.pick(['application/pdf', 'image/png', 'audio/webm'])];
    }
  }

  if (rng.bool(0.3)) {
    optional.default = rng.pick<string | number | boolean | null>([
      'x',
      1,
      true,
      null,
    ]);
  }

  return { ...base, ...optional };
}

/**
 * Build one widget of an exact kind. `genui_part` always carries a `genuiKind`
 * (its refinement requires it), and a random subset attach a vetted `query` /
 * `tool` binding drawn from the capability registry. `config` is left null (a
 * valid placeholder) most of the time so the spec stays in-bounds regardless of
 * kind — the per-kind config schema is exercised separately by the test through
 * `parseWidgetConfig` on the catalog samples.
 */
function buildWidget(
  rng: Prng,
  kind: PortalTabWidgetKind,
  key: string,
): PortalTabWidget {
  const base = {
    key,
    kind,
    title: label(rng, 'W'),
    config: null,
  } as PortalTabWidget;

  const extra: Partial<PortalTabWidget> = {};
  if (rng.bool(0.5)) extra.subtitle = label(rng, 'sub');
  if (rng.bool(0.5)) extra.span = rng.pick([1, 6, 12]);

  if (kind === 'genui_part') {
    extra.genuiKind = rng.pick(PORTAL_DASHBOARD_KIND_NAMES);
  }

  // Attach a vetted binding sometimes — query or tool, both registry-checked.
  if (rng.bool(0.4)) {
    if (rng.bool()) {
      extra.binding = {
        kind: 'query',
        resource: rng.pick(PORTAL_QUERY_RESOURCES),
        ...(rng.bool(0.5)
          ? { filters: { status: rng.pick(['overdue', 'open', 'paid']) } }
          : {}),
      };
    } else {
      extra.binding = {
        kind: 'tool',
        toolId: rng.pick(PORTAL_TOOL_IDS),
        ...(rng.bool(0.5) ? { args: { dryRun: rng.bool() } } : {}),
      };
    }
  }

  return { ...base, ...extra };
}

/**
 * Build a section with random (but bounded) field + widget counts. Guarantees
 * the section is non-empty (the schema rejects empty sections). Field keys are
 * uniquified per-section by index so the tab-level duplicate-key refinement
 * never trips.
 */
function buildSection(
  rng: Prng,
  index: number,
  sinks: CoverageSinks,
  forced: SpecGenOptions,
): PortalTabSection {
  const fieldCount = rng.int(forced.forceFieldKind ? 1 : 0, 6);
  const widgetCount = rng.int(forced.forceWidgetKind ? 1 : 0, 5);

  const fields: PortalTabField[] = [];
  for (let i = 0; i < fieldCount; i += 1) {
    const kind =
      i === 0 && forced.forceFieldKind
        ? forced.forceFieldKind
        : rng.pick(PORTAL_TAB_FIELD_KINDS);
    sinks.markFieldKind(kind);
    fields.push(buildField(rng, kind, `f${index}_${i}`));
  }

  const widgets: PortalTabWidget[] = [];
  for (let i = 0; i < widgetCount; i += 1) {
    const kind =
      i === 0 && forced.forceWidgetKind
        ? forced.forceWidgetKind
        : rng.pick(PORTAL_TAB_WIDGET_KINDS);
    sinks.markWidgetKind(kind);
    widgets.push(buildWidget(rng, kind, `w${index}_${i}`));
  }

  // Guarantee non-empty even when both random counts landed on 0.
  if (fields.length === 0 && widgets.length === 0) {
    const kind = rng.pick(PORTAL_TAB_FIELD_KINDS);
    sinks.markFieldKind(kind);
    fields.push(buildField(rng, kind, `f${index}_0`));
  }

  const section: PortalTabSection = {
    key: `s${index}`,
    title: label(rng, 'S'),
    fields,
    widgets,
  };
  if (rng.bool(0.3)) {
    return { ...section, description: label(rng, 'desc'), defaultCollapsed: rng.bool() };
  }
  return section;
}

/**
 * Generate ONE schema-valid `PortalTab` spec from the seeded PRNG. In-bounds by
 * construction; the only randomness source is `rng`, so the same seed replays
 * the identical spec.
 */
export function generatePortalTabSpec(
  rng: Prng,
  sinks: CoverageSinks,
  options: SpecGenOptions = {},
): PortalTab {
  const id = token(rng, 'tab_');
  const sectionCount = rng.int(1, 4); // schema bound: 1..20
  const sections = Array.from({ length: sectionCount }, (_, i) =>
    // Pin the forced kinds into the FIRST section only.
    buildSection(rng, i, sinks, i === 0 ? options : {}),
  );

  const personaCount = rng.int(1, PERSONAS.length);
  const visibleToPersonas = PERSONAS.slice(0, personaCount);

  const createdAt = rng.pick(ISO_SAMPLES);
  const updatedAt = rng.pick(ISO_SAMPLES);

  const tab: PortalTab = {
    id,
    version: PORTAL_TAB_SCHEMA_VERSION,
    tenantId: token(rng, 'tenant_'),
    userId: rng.bool() ? token(rng, 'user_') : null,
    tabKey: `${rng.pick(['hr', 'fin', 'ops'])}.${token(rng, 'k')}`,
    title: label(rng, 'Tab'),
    description: rng.bool(0.5) ? label(rng, 'about') : '',
    icon: rng.pick(['Briefcase', 'Wallet', 'ShieldCheck', '']),
    domain: rng.pick(DOMAINS),
    sections,
    permissions: {
      visibleToPersonas,
      ...(rng.bool(0.4) ? { ownerOnlyEdits: rng.bool() } : {}),
    },
    audit: {
      createdBy: token(rng, 'by_'),
      updatedBy: token(rng, 'by_'),
      history: rng.bool(0.5)
        ? [
            {
              actor: rng.pick(['system', 'user', 'agent', 'admin']),
              actorId: token(rng, 'a_'),
              action: rng.pick(['created', 'edited', 'imported', 'reset', 'deleted']),
              at: rng.pick(ISO_SAMPLES),
            },
          ]
        : [],
    },
    createdAt,
    updatedAt,
  };

  if (rng.bool(0.5)) {
    return {
      ...tab,
      record: { enabled: rng.bool() },
    };
  }
  return tab;
}

/** Re-exported catalog handles so the test asserts coverage against them. */
export const ALL_FIELD_KIND_NAMES = PORTAL_TAB_FIELD_KINDS;
export const ALL_WIDGET_KIND_NAMES = PORTAL_TAB_WIDGET_KINDS;
export const ALL_LOCALE_NAMES = PORTAL_LOCALES;
