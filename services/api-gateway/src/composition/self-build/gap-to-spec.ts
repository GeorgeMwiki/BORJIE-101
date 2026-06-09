/**
 * gap-to-spec.ts — the GENERATIVE bridge from a recorded capability gap
 * (an md_commitments row with a non-null `gap_kind`, migration 0326) to a
 * grammar-valid `ModuleSpec` (the locked DSL of `@borjie/module-spec-engine`).
 *
 * THE GENERATIVE PRINCIPLE (never per-case hardcode): a gap is a typed,
 * structured impasse — a `gapKind`, a `competenceDomain`, a domain `kind`
 * verb, an `unblockTrigger`, a bilingual title. This module DERIVES a module
 * slug + a capability-ledger entity + a review UI from THOSE fields by pure
 * transformation, so a brand-new gap kind / domain / verb that has never been
 * seen produces a valid spec with zero code change. There is NO dictionary of
 * known gaps — the slug, the entity, and the fields are computed from the gap.
 *
 * The derived module is intentionally MINIMAL + SAFE: a single record-ledger
 * entity that captures the work the missing capability would track, plus a
 * table + form + KPI-tile UI. It is a PROPOSAL skeleton an operator reviews +
 * elaborates — it is NEVER applied here (the self-build orchestrator stores it
 * as a proposal; apply is a separate four-eye-gated step).
 *
 * Pure: no I/O, no mutation. The output always satisfies the
 * `module-spec-engine` grammar (slug regex, field caps, FK integrity) so
 * `validateSpec` / `compileSpec` accept it deterministically.
 */

import type { ModuleSpec, FieldDecl } from '@borjie/module-spec-engine';

/**
 * The minimal projection of a recorded gap this deriver reads. Mirrors the
 * `MdCommitment` shape (gap fields from migration 0326) without importing the
 * whole repository type — keeps this module dependency-light + pure.
 */
export interface RecordedGap {
  readonly id: string;
  readonly tenantId: string;
  /** The typed gap discriminator (non-null for a gap). */
  readonly gapKind: string;
  /** Domain verb describing the blocked intent (e.g. 'royalty.reconcile'). */
  readonly kind: string;
  readonly title: string;
  readonly titleSw: string;
  readonly rationale: string;
  /** Jagged-frontier coordinate (licences | royalty | treasury | ...). */
  readonly competenceDomain: string | null;
  /** The predicate that would flip the gap to confident ({ kind, target }). */
  readonly unblockTrigger: { readonly kind: string; readonly target: string } | null;
}

/** The grammar slug bound: snake_case, leading letter, max 48 (SLUG_REGEX). */
const SLUG_MAX = 48;

/**
 * The derived spec + the human-stable module slug it should spawn under. The
 * orchestrator persists the module under `moduleSlug` (idempotent per tenant)
 * and compiles `spec`.
 */
export interface DerivedModulePlan {
  readonly moduleSlug: string;
  readonly title: string;
  readonly titleSw: string;
  readonly spec: ModuleSpec;
}

/**
 * Coerce ANY free-form string into a grammar-legal slug fragment:
 * lowercase, ASCII letters/digits/underscores, leading letter, bounded
 * length. A purely-non-alpha input falls back to a stable hash fragment so
 * the result always matches `^[a-z][a-z0-9_]{0,47}$`.
 */
export function toSlugFragment(input: string, maxLen = SLUG_MAX): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  // Must start with a letter (the leading-letter rule neutralises injection +
  // reserved-word + leading-digit collisions).
  const withLeadingLetter = /^[a-z]/.test(cleaned)
    ? cleaned
    : `g_${cleaned}`;
  const bounded = withLeadingLetter.slice(0, maxLen).replace(/_+$/g, '');
  return bounded.length > 0 ? bounded : 'gap';
}

/**
 * The module slug a gap proposes. Combines the competence domain (or the gap
 * kind when no domain) with a short stable fragment of the gap id so two gaps
 * in the same domain never collide on the per-tenant UNIQUE(tenant, slug).
 */
export function deriveModuleSlug(gap: RecordedGap): string {
  const domain = gap.competenceDomain
    ? toSlugFragment(gap.competenceDomain, 24)
    : toSlugFragment(gap.gapKind, 24);
  const idFragment = shortIdFragment(gap.id);
  return toSlugFragment(`${domain}_capability_${idFragment}`);
}

/** A short, slug-legal fragment of an id (last 8 alphanumerics, letter-led). */
function shortIdFragment(id: string): string {
  const alnum = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tail = alnum.slice(-8) || 'x';
  return /^[a-z]/.test(tail) ? tail : `m${tail}`;
}

/**
 * Build the capability-ledger entity for the gap. Every derived module gets
 * ONE entity that records instances of the work the missing capability would
 * perform — a deterministic, safe, minimal schema. The fields are generative:
 * the enum's `status` values + the `domain` text are derived, not fixed.
 */
function buildLedgerEntity(gap: RecordedGap, entitySlug: string): {
  readonly slug: string;
  readonly display_name_en: string;
  readonly display_name_sw: string;
  readonly fields: ReadonlyArray<FieldDecl>;
} {
  const fields: FieldDecl[] = [
    { name: 'summary', kind: 'text', required: true, max_length: 500 },
    { name: 'detail', kind: 'text', required: false, max_length: 4000 },
    {
      name: 'status',
      kind: 'enum',
      required: true,
      values: ['open', 'in_progress', 'resolved', 'rejected'],
    },
    { name: 'occurred_at', kind: 'datetime', required: true },
  ];
  // The domain coordinate becomes an indexed text field so the operator can
  // filter the ledger by the jagged-frontier coordinate the gap belongs to.
  if (gap.competenceDomain) {
    fields.push({
      name: 'competence_domain',
      kind: 'text',
      required: false,
      max_length: 64,
      index: true,
    });
  }
  return {
    slug: entitySlug,
    display_name_en: clampTitle(gap.title, 128),
    display_name_sw: clampTitle(gap.titleSw, 128),
    fields,
  };
}

/**
 * Derive a complete, grammar-valid `ModuleSpec` from a recorded gap. The
 * output is ALWAYS valid against the locked DSL — `validateSpec` accepts it —
 * so the self-build orchestrator can compile + dry-run it deterministically.
 *
 * Generative, not hardcoded: the entity slug, the module slug, the titles, the
 * indexed domain field, and the KPI query are all transformations of the gap's
 * own fields. A never-before-seen gap produces a valid proposal with no code
 * change.
 */
export function deriveModulePlanFromGap(gap: RecordedGap): DerivedModulePlan {
  const moduleSlug = deriveModuleSlug(gap);
  // The entity slug is the gap-kind family so the operator reads it as the
  // *kind* of capability (e.g. `royalty_records`). Bounded conservatively to
  // leave room for the compiler's `tenant_mod_{tenantId}_` prefix + the longest
  // index suffix (`_competence_domain_idx`, 22 bytes) under the 63-byte
  // Postgres identifier limit. When a long tenant id still pushes the concrete
  // identifier over the limit the compiler returns a structured error and the
  // orchestrator honest-degrades — it never crashes.
  const entitySlug = toSlugFragment(
    `${gap.competenceDomain ?? gap.gapKind}_records`,
    28,
  );
  const entity = buildLedgerEntity(gap, entitySlug);

  const spec: ModuleSpec = {
    entities: [
      {
        slug: entity.slug,
        display_name_en: entity.display_name_en,
        display_name_sw: entity.display_name_sw,
        fields: [...entity.fields],
      },
    ],
    workflows: [
      {
        slug: toSlugFragment(`on_${entitySlug}_create`, 48),
        title: clampTitle(`Triage ${gap.title}`, 128),
        trigger_entity: entitySlug,
        trigger_event: 'create',
        steps: ['notify_owner'],
      },
    ],
    ui_sections: [
      {
        kind: 'table',
        entity: entitySlug,
        columns: ['summary', 'status', 'occurred_at'],
      },
      { kind: 'form', entity: entitySlug },
      {
        kind: 'kpi_tile',
        title: clampTitle(`Open ${gap.title}`, 128),
        query: `count.${entitySlug}.status.open`,
      },
    ],
  };

  return Object.freeze({
    moduleSlug,
    title: clampTitle(gap.title, 128),
    titleSw: clampTitle(gap.titleSw, 128),
    spec,
  });
}

/** Bound a display title to the grammar's max length without throwing. */
function clampTitle(s: string, max: number): string {
  const trimmed = (s ?? '').trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return 'Capability';
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}
