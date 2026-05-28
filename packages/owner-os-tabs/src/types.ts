/**
 * OwnerOS Tab Type Registry — the contract.
 *
 * Wave OWNER-OS-DYNAMIC. Today the OwnerOSShell renders a hardcoded
 * set of tabs (Chat / Docs / Drafts / Reminders / Insights). This
 * package generalises that surface so ANY domain (HR, Ops, Finance,
 * Accounting, Risk, Compliance, Workforce, Procurement, Audit, Legal,
 * ESG, Geology, Treasury, Marketplace, Licences, anything else) can
 * register itself as a spawnable tab with a single descriptor file.
 *
 * The contract is intentionally tiny:
 *
 *   1. Every team writes ONE descriptor (id, label, icon name, color,
 *      context schema, intent matchers, suggested tools, brief slices).
 *   2. The renderer function is opaque — the descriptor references it
 *      by id; the consuming app (apps/owner-web) wires the React
 *      component up via a separate "panel renderer map".
 *   3. The brain emits `<spawn_tabs>{...}</spawn_tabs>` on every reply
 *      that touches an actionable domain. The gateway validates the
 *      payload against the registry's zod schema.
 *   4. The FE intent matcher (also in this package) runs DETERMINISTIC
 *      keyword + regex matching every time the owner types a message
 *      so the ambient "Suggested for now" banner can surface the top
 *      candidate without an LLM call.
 *
 * Zero React deps live in this package — the descriptor stores the
 * renderer COMPONENT ID, not the component itself, so the contract can
 * be consumed from both the FE (apps/owner-web) and the gateway
 * (services/api-gateway) without dragging React into Node.
 *
 * See:
 *   - apps/owner-web/src/components/owner-os/panels/*  (panel impls)
 *   - apps/owner-web/src/components/owner-os/OwnerOSShell.tsx
 *   - services/api-gateway/src/routes/brain-teach.hono.ts
 */

import { z } from 'zod';

// ─── Public union of tab type ids ───────────────────────────────────
//
// Owners can spawn ANY of these via the "+" menu, the brain can spawn
// them via <spawn_tabs>, and the ambient banner can suggest them. Adding
// a new domain is a one-line addition here + one descriptor file.
//
// The order in this union also drives the default "+" menu ordering for
// fresh sessions (the registry resorts by intent score afterwards).

export const OWNER_OS_TAB_TYPES = [
  // Built-ins (pinned in default state).
  'chat',
  'docs',
  'drafts',
  'reminders',
  'insights',
  'doc-context',
  // Mining-domain spawnables. The brain + intent matcher + "+" menu
  // pick from this set. New entries are additive; never remove.
  'hr',
  'ops',
  'finance',
  'accounting',
  'risk',
  'compliance',
  'workforce',
  'procurement',
  'audit',
  'legal',
  'esg',
  'geology',
  'treasury',
  'marketplace',
  'licences',
  'sites',
  'safety',
  'reports',
] as const;

export type OwnerOSTabType = (typeof OWNER_OS_TAB_TYPES)[number];

export const ownerOsTabTypeSchema = z.enum(OWNER_OS_TAB_TYPES);

// ─── Context schema — every descriptor narrows this ─────────────────
//
// The brain uses these keys to scope a spawn ("focus": "NEMC EIA
// Geita" / "siteId": "...") so the panel can pre-filter immediately.
// Keep the surface tiny — a panel that needs more fields should add
// them inside its OWN extension schema, not pollute the global one.

export const ownerOsTabContextSchema = z
  .object({
    /** Free-form focus phrase the brain extracted from the conversation. */
    focus: z.string().min(1).max(200).optional(),
    /** Scope to a single mining site / PML / ML. */
    siteId: z.string().min(1).max(120).optional(),
    /** Scope to a single licence. */
    licenceId: z.string().min(1).max(120).optional(),
    /** Scope to a single employee / supervisor. */
    employeeId: z.string().min(1).max(120).optional(),
    /** Scope to a single supplier / buyer counterparty. */
    counterpartyId: z.string().min(1).max(120).optional(),
    /** Scope to a single document. */
    documentId: z.string().min(1).max(120).optional(),
    /** Optional date range — ISO 8601 strings. */
    dateRange: z
      .object({
        from: z.string().min(1).max(40),
        to: z.string().min(1).max(40),
      })
      .optional(),
    /** Optional language override per-tab (defaults to owner's preference). */
    locale: z.enum(['sw', 'en']).optional(),
    /** Free-form key-value extension; bounded to keep jsonb sane. */
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type OwnerOSTabContext = z.infer<typeof ownerOsTabContextSchema>;

// ─── Spawn intent — what the brain emits per turn ───────────────────

export const ownerOsSpawnIntentSchema = z.object({
  type: ownerOsTabTypeSchema,
  context: ownerOsTabContextSchema.default({}),
  /** 1-line plain-text reason the owner reads on the suggestion chip. */
  reason: z.string().min(1).max(160),
  /** Optional confidence score (0..1). The brain may omit; FE defaults to 0.5. */
  confidence: z.number().min(0).max(1).optional(),
});

export type OwnerOSSpawnIntent = z.infer<typeof ownerOsSpawnIntentSchema>;

/**
 * The shape the brain emits in a `<spawn_tabs>{...}</spawn_tabs>` tag.
 * Capped at 3 candidates per turn (the system prompt enforces it too).
 */
export const ownerOsSpawnBatchSchema = z.object({
  tabs: z.array(ownerOsSpawnIntentSchema).max(3),
});

export type OwnerOSSpawnBatch = z.infer<typeof ownerOsSpawnBatchSchema>;

// ─── Descriptor — what a panel file exports ─────────────────────────
//
// A descriptor is the single file every team writes to register a new
// tab type. Keep this lean — the renderer reference is a string id, not
// a React component, so this contract has zero React-runtime deps.

/** A short, lower-case Borjie semantic-token color. */
export type OwnerOSTabColor =
  | 'navy'
  | 'gold'
  | 'cream'
  | 'signal'
  | 'warning'
  | 'success'
  | 'destructive'
  | 'info'
  | 'neutral';

/** Indicator-dot tone the tab strip renders. */
export type OwnerOSTabIndicator =
  /** Brain just suggested this tab (gold dot). */
  | 'suggested'
  /** Owner pinned the tab (green dot). */
  | 'pinned'
  /** Unresolved hint inside the tab (amber dot). */
  | 'hint'
  /** Regulator deadline imminent / panel errored (red dot). */
  | 'urgent'
  /** No special state — no dot rendered. */
  | 'none';

/**
 * Brief slice keys — pull-points from the owner brief that a panel can
 * surface inside its body without re-fetching. Each panel declares
 * which slices it cares about so the shell can pass them down.
 */
export type OwnerOSBriefSlice =
  | 'environment'
  | 'community'
  | 'royalties'
  | 'licences'
  | 'workforce'
  | 'incidents'
  | 'fx'
  | 'marketplace'
  | 'cashflow'
  | 'compliance'
  | 'audit-trail'
  | 'reclamation'
  | 'sites'
  | 'inventory';

/**
 * A brain-tool reference. Panels declare which existing tools should be
 * one-click reachable inside their context (e.g. ComplianceTab might
 * expose "draft-NEMC-letter", "schedule-NEMC-reminder").
 */
export interface OwnerOSToolSuggestion {
  readonly toolId: string;
  readonly labelEn: string;
  readonly labelSw: string;
}

/**
 * Intent matchers — patterns the deterministic matcher scans against the
 * owner's last message + the most recent brain reply. The matcher is
 * keyword/regex only (no LLM) so it is instant and free.
 */
export interface OwnerOSIntentMatchers {
  /** Lowercase substrings — match if any appear in the haystack. */
  readonly keywords: ReadonlyArray<string>;
  /** Regex patterns — match if any test() returns true. */
  readonly patterns?: ReadonlyArray<RegExp>;
  /**
   * Score boost (0..1) when ALL of these phrases appear together. Use for
   * domain-specific co-occurrence (e.g. "compliance" + "NEMC").
   */
  readonly comboBoost?: ReadonlyArray<{
    readonly phrases: ReadonlyArray<string>;
    readonly boost: number;
  }>;
}

/**
 * One descriptor per tab type. Registered via `registerTab()` on module
 * load by each panel file.
 */
export interface OwnerOSTabDescriptor {
  /** Stable id matching `OwnerOSTabType`. */
  readonly type: OwnerOSTabType;
  /** Default label in EN. Owners can rename per-tab. */
  readonly labelEn: string;
  /** Default label in SW. */
  readonly labelSw: string;
  /** 1-line description for the "+" menu, in EN. */
  readonly descriptionEn: string;
  /** 1-line description for the "+" menu, in SW. */
  readonly descriptionSw: string;
  /**
   * lucide-react icon name (string, not the component). The shell maps
   * this to the icon at render time so the descriptor stays React-free.
   * See https://lucide.dev/icons for the canonical list.
   */
  readonly iconName: string;
  /** Semantic color token (drives the tab pill + dot). */
  readonly color: OwnerOSTabColor;
  /**
   * Zod schema for this tab's context. Default = the shared
   * `ownerOsTabContextSchema`. Panels that need extra fields override
   * with a `.extend()` call.
   */
  readonly contextSchema: z.ZodTypeAny;
  /** Deterministic intent matchers for the ambient banner + suggest. */
  readonly intentMatchers: OwnerOSIntentMatchers;
  /** Brain-tool refs the panel exposes one-click in its toolbar. */
  readonly suggestedTools: ReadonlyArray<OwnerOSToolSuggestion>;
  /** Owner-brief slice keys this panel reads. */
  readonly briefSlices: ReadonlyArray<OwnerOSBriefSlice>;
  /**
   * Renderer id — opaque string the FE maps to a React component via the
   * `PANEL_RENDERERS` table in apps/owner-web. The contract package does
   * NOT touch React. New panels follow the convention
   * "panel:<type>" (e.g. "panel:hr", "panel:compliance").
   */
  readonly rendererId: string;
  /**
   * Optional: when true, the tab is created PINNED by default the first
   * time the brain spawns it (e.g. Chat / Docs are always pinned).
   */
  readonly pinnedByDefault?: boolean;
  /**
   * Optional: when true, the "+" menu hides this descriptor — the brain
   * is the only way it spawns (e.g. doc-context). Defaults to false.
   */
  readonly hiddenFromSpawnMenu?: boolean;
  /**
   * Optional: a deterministic id-builder so re-spawning the same context
   * produces the same tabId (idempotency). Default = `${type}:default`.
   * Panels with `siteId` / `licenceId` etc. should override.
   */
  readonly buildTabId?: (context: OwnerOSTabContext) => string;
}

// ─── Persisted tab record (FE shape) ─────────────────────────────────
//
// The owner_tabs jsonb stores arrays of these. The FE owns the schema
// (server is a key-value store), so this is the canonical shape.

export const ownerOsPersistedTabSchema = z.object({
  id: z.string().min(1).max(160),
  type: ownerOsTabTypeSchema,
  labelEn: z.string().min(1).max(60).optional(),
  labelSw: z.string().min(1).max(60).optional(),
  context: ownerOsTabContextSchema.default({}),
  isPinned: z.boolean().default(false),
  position: z.number().int().min(0).max(999).default(0),
  lastOpenedAt: z.string().min(1).max(40).optional(),
  indicator: z
    .enum(['suggested', 'pinned', 'hint', 'urgent', 'none'])
    .default('none')
    .optional(),
});

export type OwnerOSPersistedTab = z.infer<typeof ownerOsPersistedTabSchema>;

export const ownerOsTabsStateSchema = z.object({
  tabs: z.array(ownerOsPersistedTabSchema).max(40),
  activeTabId: z.string().nullable(),
  updatedAt: z.string().min(1).max(40),
});

export type OwnerOSTabsState = z.infer<typeof ownerOsTabsStateSchema>;
