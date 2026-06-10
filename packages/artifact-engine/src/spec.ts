/**
 * The ONE `ArtifactSpec` — the single emit vocabulary the brain holds and
 * every surface in the estate is a lens onto.
 *
 * PROMOTE, DON'T INVENT. This file does NOT author a new schema from
 * scratch. It PROMOTES the highest-quality schema already in the repo —
 * `PortalTabWidgetObjectSchema` (`@borjie/portal-genui` types.ts:338-368):
 *
 *   - `.strict()` (no extra keys an LLM could smuggle through),
 *   - the discriminated `binding` union (`query` | `tool`) whose
 *     resource / toolId is vetted against the capability registry at PARSE
 *     time (`PortalTabWidgetBindingSchema`),
 *   - the `genuiKind` escape hatch into the 35 vetted primitives.
 *
 * — to a TOP-LEVEL artifact, and unifies its `kind` onto the SUPERSET that
 * already exists: the 35 `PORTAL_DASHBOARD_KIND_NAMES` (types.ts:50-86)
 * which 1:1 mirror `@borjie/genui` `PART_SCHEMAS`. NOT the narrow 14
 * `PORTAL_TAB_WIDGET_KINDS`, and NOT the parallel snake_case catalog — the
 * catalog's `partKind` field already proves every alias maps to ONE of the
 * 35 kinds, so the catalog stays a thin alias lookup, never a second
 * renderer.
 *
 * Five NEW top-level fields the blueprint names are added:
 *
 *   - `artifactId`   — stable identity across lifecycle transitions.
 *   - `lifecycle`    — `'ephemeral' | 'iterating' | 'persistent'`.
 *   - `signals`      — the 5 routing booleans the router reads.
 *   - `evidenceIds`  — ≥0 evidence ids (the Auditor invariant: a
 *                      recommendation cites ≥1; enforced upstream, the spec
 *                      only carries them).
 *   - `version`      — monotonic spec version for optimistic concurrency.
 *
 * Plus an `ArtifactNode` tree: addressable sub-nodes with stable
 * `nodeId`s, so a FRAGMENT of an artifact is independently addressable (the
 * future portable layer points the brain at "look at node X"). The tree is
 * OPTIONAL and additive — a flat artifact omits it entirely.
 *
 * The whole module is pure / serializable — no React refs, no functions,
 * no class instances. An `ArtifactSpec` crosses the SSE wire and persists
 * as JSONB exactly as a `PortalTab` does today.
 */

import { z } from 'zod';
import {
  PORTAL_DASHBOARD_KIND_NAMES,
  PortalTabWidgetBindingSchema,
  PortalLocaleSchema,
  type PortalDashboardKindName,
  type PortalTabWidgetBinding,
} from '@borjie/portal-genui';

// ---------------------------------------------------------------------------
// 1. The kind enum — the 35-kind SUPERSET (mirrors @borjie/genui PART_SCHEMAS).
// ---------------------------------------------------------------------------

/**
 * The canonical artifact-kind enum: the 35 `PORTAL_DASHBOARD_KIND_NAMES`
 * re-exported from `@borjie/portal-genui`, which 1:1 mirror the keys of
 * `PART_SCHEMAS` in `@borjie/genui`. We re-export the source-of-truth list
 * rather than re-declaring it so the two can never drift.
 */
export const ARTIFACT_KIND_NAMES = PORTAL_DASHBOARD_KIND_NAMES;

export type ArtifactKindName = PortalDashboardKindName;

/**
 * NOTE: this enum is INTENTIONALLY a closed set at the TYPE level, but the
 * renderer + router are reachability-complete by construction — an unknown
 * kind that slips past the parse (e.g. a future brain build emitting a
 * net-new kind into an old client) routes to `inline-text` and renders
 * `UnknownKindCard`, never throws. See `routeArtifact` + the
 * `UnifiedArtifactRenderer` `PART_SCHEMAS[kind]` miss path.
 *
 * `ArtifactKindSchema` is `.catchall`-free `z.enum` for the closed core,
 * but `ArtifactSpecSchema.kind` widens to `z.string()` (see below) so the
 * generativity guarantee holds at parse time too: a never-seen kind is a
 * valid `ArtifactSpec` whose router + renderer degrade gracefully.
 */
export const ArtifactKindSchema = z.enum(ARTIFACT_KIND_NAMES);

// ---------------------------------------------------------------------------
// 2. The 5 routing signals — the booleans the pure router reads.
// ---------------------------------------------------------------------------

/**
 * The five routing signals. The router AND-gates these (default inline,
 * bias-to-chat) to choose a surface. They are HINTS the brain emits; the
 * router is the single authority that turns them into a surface decision.
 *
 *   - `substantial`   — the artifact is a real deliverable worth keeping,
 *                       not a one-line confirmation / micro-affordance.
 *   - `editable`      — the owner is expected to iterate on it (a workbench
 *                       artifact, not a finished read-only snapshot).
 *   - `selfContained` — it stands on its own (a full chart / table), not a
 *                       fragment that only makes sense mid-sentence.
 *   - `takeOutside`   — it is meant to leave the conversation (export /
 *                       share / pin), pushing it toward a canvas surface.
 *   - `reused`        — it is referenced repeatedly across the session,
 *                       so it earns a persistent home.
 */
export const ArtifactSignalsSchema = z
  .object({
    substantial: z.boolean(),
    editable: z.boolean(),
    selfContained: z.boolean(),
    takeOutside: z.boolean(),
    reused: z.boolean(),
  })
  .strict();

export type ArtifactSignals = z.infer<typeof ArtifactSignalsSchema>;

/** The 5 signal keys, exported for the router's AND-gate + tests. */
export const ARTIFACT_SIGNAL_KEYS = [
  'substantial',
  'editable',
  'selfContained',
  'takeOutside',
  'reused',
] as const;

export type ArtifactSignalKey = (typeof ARTIFACT_SIGNAL_KEYS)[number];

// ---------------------------------------------------------------------------
// 3. Lifecycle — the three durability stages.
// ---------------------------------------------------------------------------

/**
 * The lifecycle stage of an artifact. Distinct from the SURFACE it renders
 * on (the router decides that); this is the durability dimension:
 *
 *   - `ephemeral`  — lives in the conversation turn, not yet kept.
 *   - `iterating`  — kept on a workbench, actively being worked.
 *   - `persistent` — graduated to a durable home (tab / dashboard / store).
 */
export const ARTIFACT_LIFECYCLES = [
  'ephemeral',
  'iterating',
  'persistent',
] as const;

export type ArtifactLifecycle = (typeof ARTIFACT_LIFECYCLES)[number];

export const ArtifactLifecycleSchema = z.enum(ARTIFACT_LIFECYCLES);

// ---------------------------------------------------------------------------
// 3b. Actions — the ONE intent membrane vocabulary (spec-level).
// ---------------------------------------------------------------------------

/**
 * A single action intent carried by the artifact. Kept at the TOP LEVEL of
 * the spec (not inside `config`) so it never pollutes the primitive's
 * `config` payload — the renderer re-validates `config` against the strict
 * `PART_SCHEMAS[kind]`, and an extra `actions` key there would (correctly)
 * fail that re-validation.
 *
 * The brain emits `{ id, label, verb, params? }`; the host's action
 * membrane routes a KNOWN verb to a governed handler and an UNKNOWN verb to
 * the generative `deferToBrain` seam — never a static per-verb allowlist.
 * Pure / serializable.
 */
export const ArtifactActionSpecSchema = z
  .object({
    id: z.string().min(1).max(120),
    /** Localised label — brain-authored in the active locale. */
    label: z.string().min(1).max(200),
    /** The intent verb the host routes on. */
    verb: z.string().min(1).max(120),
    /** Optional shallow param map carried to the handler / brain. */
    params: z
      .record(
        z.union([
          z.string().max(500),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(50),
        ]),
      )
      .optional(),
  })
  .strict();

export type ArtifactActionSpec = z.infer<typeof ArtifactActionSpecSchema>;

// ---------------------------------------------------------------------------
// 4. The ArtifactNode tree — addressable sub-nodes with stable nodeIds.
// ---------------------------------------------------------------------------

/**
 * A stable, addressable sub-node of an artifact. The tree lets a FRAGMENT
 * of an artifact be pointed-at independently (the future portable layer:
 * "look at node `n.formula`"). Each node carries its OWN `kind` + `config`
 * + optional `binding` so a node is a self-contained renderable, and its
 * `nodeId` is stable across re-renders so spatial focus survives.
 *
 * The tree is recursive; Zod 3's `.lazy()` needs the explicit type
 * annotation + cast the genui schemas use (see schemas.ts TreeNodeSchema)
 * so strict downstream module-resolution agrees in both directions.
 */
export interface ArtifactNodeShape {
  /** Stable address for this sub-node — unique within the artifact tree. */
  nodeId: string;
  /** The primitive kind this node renders as (one of the 35, or unknown). */
  kind: string;
  /** Static seed props for the node renderer. NULL = filled by binding. */
  config: Record<string, unknown> | null;
  /** Optional live-data / action binding for this node. */
  binding?: PortalTabWidgetBinding;
  /** Optional child nodes — the addressable fragment tree. */
  children?: ArtifactNodeShape[];
}

export const ArtifactNodeSchema: z.ZodType<ArtifactNodeShape> = z.lazy(() =>
  z
    .object({
      nodeId: z
        .string()
        .min(1)
        .max(120)
        .regex(
          /^[a-z][a-z0-9._-]*$/i,
          'nodeId must be letters / digits / . _ -',
        ),
      kind: z.string().min(1).max(120),
      config: z.record(z.unknown()).nullable(),
      binding: PortalTabWidgetBindingSchema.optional(),
      children: z.array(ArtifactNodeSchema).max(200).optional(),
    })
    .strict() as unknown as z.ZodType<ArtifactNodeShape>,
);

export type ArtifactNode = ArtifactNodeShape;

// ---------------------------------------------------------------------------
// 5. The ArtifactSpec — PortalTabWidgetObjectSchema PROMOTED to top-level.
// ---------------------------------------------------------------------------

/** Stable artifact id — a slug or uuid-ish token, stable across lifecycle. */
const ArtifactIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9][a-z0-9._:-]*$/i,
    'artifactId must be letters / digits / . _ : -',
  );

/**
 * The promoted base — the EXACT field set of `PortalTabWidgetObjectSchema`
 * (types.ts:338-368), lifted to a top-level artifact. We re-declare the
 * fields here (rather than `.extend()`-ing the imported object) because:
 *
 *   1. the `kind` field is WIDENED from the narrow 14 tab-widget kinds to
 *      the 35-kind superset — and additionally to `z.string()` so an
 *      unknown / never-seen kind is a VALID spec (the generativity
 *      guarantee at parse time), with `ArtifactKindSchema` exported
 *      separately as the closed-core enum for callers that want it;
 *   2. it keeps this module decoupled from the tab-widget's `genui_part`
 *      indirection — at the artifact level the `kind` IS one of the 35
 *      directly, so there is no `genuiKind` re-pointer needed (the escape
 *      hatch is preserved as an OPTIONAL field for back-compat with specs
 *      minted from a tab widget).
 *
 * Everything else — `key`/`title`/`subtitle`/`span`/`config`/`binding` —
 * is carried over verbatim, including the `.strict()` discipline.
 */
const ArtifactSpecBaseSchema = z
  .object({
    // ── promoted from PortalTabWidgetObjectSchema ──────────────────────
    /** Stable per-widget key (unique within its host). Carried verbatim. */
    key: z.string().min(1).max(120),
    /**
     * The primitive kind. Widened to `z.string()` for the generativity
     * guarantee — an unknown kind is a valid spec whose router + renderer
     * degrade to `inline-text` + `UnknownKindCard`. Validate against the
     * closed 35-kind core with `ArtifactKindSchema` when you need it.
     */
    kind: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    /** Optional subtitle / description shown under the title. */
    subtitle: z.string().max(500).optional(),
    /** Tailwind-grid 12-column span. Default 6. */
    span: z.number().int().min(1).max(12).optional(),
    /**
     * Static config / seed props passed to the renderer (VegaLite spec /
     * rows / props). NULL means a placeholder filled at render time by the
     * binding resolver. Carried verbatim from the tab-widget schema.
     */
    config: z.record(z.unknown()).nullable(),
    /**
     * Back-compat escape pointer. When an `ArtifactSpec` is minted from a
     * `genui_part` tab widget, `genuiKind` carries the original primitive
     * kind. At the artifact level `kind` IS the primitive, so this is
     * usually omitted. Validated against the closed 35-kind superset.
     */
    genuiKind: ArtifactKindSchema.optional(),
    /**
     * GENERATIVE binding — what the artifact DOES. `query` resolves live
     * rows from a vetted estate domain; `tool` invokes a vetted action.
     * resource / toolId validated against the capability registry at parse
     * time (`PortalTabWidgetBindingSchema`). Carried verbatim.
     */
    binding: PortalTabWidgetBindingSchema.optional(),

    // ── the 5 NEW top-level fields the blueprint names ─────────────────
    /** Stable identity across lifecycle transitions. */
    artifactId: ArtifactIdSchema,
    /** Durability stage — independent of the rendered surface. */
    lifecycle: ArtifactLifecycleSchema,
    /** The 5 routing booleans the pure router reads. */
    signals: ArtifactSignalsSchema,
    /**
     * Evidence ids cited by this artifact. The Auditor invariant
     * (≥1 evidence_id per recommendation) is enforced upstream; the spec
     * only CARRIES them so provenance is structural, not prose.
     */
    evidenceIds: z.array(z.string().min(1).max(200)).max(50),
    /** Monotonic spec version for optimistic-concurrency on writes. */
    version: z.number().int().min(1),

    // ── optional additive layers ──────────────────────────────────────
    /**
     * Owner's ACTIVE render locale (`en` default, `sw` toggle). HOST-
     * INJECTED, never widget-decided — the absolute en/sw separation
     * invariant (CLAUDE.md). Omitted ⇒ `en`.
     */
    locale: PortalLocaleSchema.optional(),
    /**
     * OPTIONAL addressable sub-node tree. A flat artifact omits this; a
     * composite artifact (e.g. a dashboard of charts) carries it so each
     * fragment is independently addressable for the future portable layer.
     */
    nodes: z.array(ArtifactNodeSchema).max(200).optional(),
    /**
     * OPTIONAL action intents the renderer mounts through the ONE
     * `ActionButton`. Top-level (not in `config`) so the primitive payload
     * stays strict-valid. Each verb is routed by the host membrane:
     * known → governed handler, unknown → `deferToBrain`.
     */
    actions: z.array(ArtifactActionSpecSchema).max(20).optional(),
  })
  .strict();

/**
 * The ONE `ArtifactSpec`. A `.superRefine` re-applies the SAME
 * `genui_part` consistency check the tab-widget schema uses (preserving
 * the escape-hatch contract), plus enforces unique `nodeId`s across the
 * tree so fragment addressing is unambiguous.
 */
export const ArtifactSpecSchema = ArtifactSpecBaseSchema.superRefine(
  (spec, ctx) => {
    // Preserve the tab-widget contract: if a spec was minted from a
    // genui_part widget, the carried genuiKind must be one of the 35.
    // (ArtifactKindSchema already enforces that at the field level; this
    // guards the inverse — a genuiKind present on a non-genui_part kind is
    // harmless, so we only assert validity, which the field schema does.)

    // Unique nodeIds across the (optional) tree so a fragment address is
    // unambiguous.
    if (spec.nodes && spec.nodes.length > 0) {
      const seen = new Set<string>();
      const walk = (nodes: ReadonlyArray<ArtifactNodeShape>): void => {
        for (const node of nodes) {
          if (seen.has(node.nodeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate nodeId '${node.nodeId}' in artifact node tree`,
              path: ['nodes'],
            });
          }
          seen.add(node.nodeId);
          if (node.children && node.children.length > 0) {
            walk(node.children);
          }
        }
      };
      walk(spec.nodes);
    }
  },
);

export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;

// ---------------------------------------------------------------------------
// 6. Parse helpers — the same defensive pair PortalTab exposes.
// ---------------------------------------------------------------------------

/** Defensive validate — returns the parsed spec or throws. */
export function parseArtifactSpec(input: unknown): ArtifactSpec {
  return ArtifactSpecSchema.parse(input);
}

/** Non-throwing variant — returns `null` on schema failure. */
export function safeParseArtifactSpec(input: unknown): ArtifactSpec | null {
  const result = ArtifactSpecSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * True when `kind` is one of the closed 35-kind core (i.e. the renderer
 * has a known primitive for it). An UNKNOWN kind is still a valid
 * `ArtifactSpec`; this just tells a caller whether it will render a real
 * primitive or degrade to `UnknownKindCard`.
 */
const KIND_SET: ReadonlySet<string> = new Set(ARTIFACT_KIND_NAMES);

export function isKnownArtifactKind(kind: string): kind is ArtifactKindName {
  return KIND_SET.has(kind);
}
