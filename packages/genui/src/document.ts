/**
 * PortalLayout — dynamic per-user UI document.
 *
 * The data substrate for BORJIE's "generative interface" — the
 * portal shape (topbar, sidebar, dashboard cells, primary action,
 * theme, feature flags, accessibility) is a JSON document stored per
 * (tenant, persona, user) rather than hard-coded React in each
 * `apps/*-portal/`. The user can edit it through chat; the AI emits
 * JSON Patches against this document; `<PortalShell>` renders from it.
 *
 * Cites the SOTA research consolidated in
 * `.audit/litfin-sota-2026-05-23/12-dynamic-per-user-ui.md` —
 * specifically the patterns from:
 *   - Wabi (a16z) — "prompt-built apps, not chat boxes"; UGS
 *     documents stored per user, remixable, persisted, evolved.
 *   - Flutter GenUI SDK DataModel pattern — centralized observable
 *     store; widgets bind to the document; only what changed
 *     re-renders; agent observes state changes.
 *   - CopilotKit Enterprise Intelligence Platform — persistent memory
 *     across sessions/devices, continuous learning from real usage.
 *   - Plasmic SDUI — components + variants + slots + tokens fetched
 *     as JSON at runtime; editors manipulate the arrangement.
 *   - Linear Custom Views + Airtable Interfaces — per-user IA as
 *     data, not code; AI-generated layout elements from natural
 *     language; layouts are saveable + shareable + bandit-able.
 *
 * Anti-patterns enforced:
 *   - NEVER inline React components or JSX in the document; only the
 *     vetted primitive registry kinds are allowed.
 *   - NEVER persist non-deterministic blobs (functions, refs,
 *     handler closures) — everything is serializable.
 *   - NEVER trust the document at render time; revalidate via Zod
 *     at the boundary (`<PortalShell>` does `safeParse` before
 *     rendering).
 *
 * Backward compat: if no document exists for a user, the resolver
 * falls back to the persona seed under `./seeds/`, which falls back
 * to the platform-default seed. Existing portals that don't yet
 * consume `<PortalShell>` keep their hard-coded layouts until they
 * migrate.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Branded primitives — keep IDs distinct from raw strings.
// ---------------------------------------------------------------------------

const Iso8601Schema = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be ISO-8601 parseable');

/** Personas mirror `packages/database/src/seeds/trc-test-org-seed.ts`. */
export const PORTAL_PERSONAS = [
  'internal_admin',
  'property_manager',
  'estate_manager',
  'owner',
  'customer',
] as const;

export type PortalPersona = (typeof PORTAL_PERSONAS)[number];

export const PortalPersonaSchema = z.enum(PORTAL_PERSONAS);

/** Vetted intent keys — the primary-action button cannot fire arbitrary URLs. */
export const PORTAL_PRIMARY_INTENTS = [
  'pay_rent',
  'request_maintenance',
  'create_lease',
  'add_property',
  'open_chat',
  'review_approvals',
  'invite_user',
  'open_compliance',
  'open_finance',
] as const;

export type PortalPrimaryIntent = (typeof PORTAL_PRIMARY_INTENTS)[number];

export const PortalPrimaryIntentSchema = z.enum(PORTAL_PRIMARY_INTENTS);

// ---------------------------------------------------------------------------
// 2. Topbar — logo + search + notifications + profile.
// ---------------------------------------------------------------------------

export const PortalTopbarLogoSchema = z
  .object({
    label: z.string().min(1).max(80),
    /** Optional href; defaults to the portal home. */
    href: z.string().max(500).optional(),
    /** Optional brand mark id rendered from the design-system brand kit. */
    markId: z.string().max(60).optional(),
  })
  .strict();

export const PortalTopbarSearchSchema = z
  .object({
    enabled: z.boolean(),
    placeholder: z.string().max(120).optional(),
    /** When the chat-first mode is active we hide the search; chat owns it. */
    scope: z.enum(['global', 'tenant', 'persona']).optional(),
  })
  .strict();

export const PortalTopbarNotificationsSchema = z
  .object({
    enabled: z.boolean(),
    /** Polling cadence in seconds — 0 disables polling. */
    pollSeconds: z.number().int().min(0).max(3600).optional(),
  })
  .strict();

export const PortalTopbarProfileSchema = z
  .object({
    enabled: z.boolean(),
    /** Optional menu items shown under the avatar — known intents only. */
    menu: z
      .array(
        z
          .object({
            label: z.string().min(1).max(80),
            intent: z.enum([
              'open_settings',
              'open_profile',
              'open_help',
              'sign_out',
            ]),
          })
          .strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();

export const PortalTopbarSchema = z
  .object({
    logo: PortalTopbarLogoSchema,
    search: PortalTopbarSearchSchema,
    notifications: PortalTopbarNotificationsSchema,
    profile: PortalTopbarProfileSchema,
  })
  .strict();

export type PortalTopbar = z.infer<typeof PortalTopbarSchema>;

// ---------------------------------------------------------------------------
// 3. Sidebar — sections of menu items.
// ---------------------------------------------------------------------------

export const PortalSidebarItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(80),
    /** Lucide-react icon name (e.g. `home`, `bar-chart-3`). Whitelisted at render. */
    icon: z.string().max(60).optional(),
    /** Path or intent target. Path is preferred; intent for cross-portal jumps. */
    href: z.string().max(500).optional(),
    intent: PortalPrimaryIntentSchema.optional(),
    badge: z.union([z.string().max(20), z.number().int().min(0)]).optional(),
    /** Hide behind a feature flag; flag presence + truthy resolves visible. */
    featureFlag: z.string().max(120).optional(),
  })
  .strict();

export const PortalSidebarSectionSchema = z
  .object({
    id: z.string().min(1).max(120),
    title: z.string().max(80).optional(),
    items: z.array(PortalSidebarItemSchema).min(1).max(24),
  })
  .strict();

export const PortalSidebarSchema = z
  .object({
    sections: z.array(PortalSidebarSectionSchema).min(1).max(8),
    /** Collapsed by default on first render. */
    defaultCollapsed: z.boolean().optional(),
  })
  .strict();

export type PortalSidebar = z.infer<typeof PortalSidebarSchema>;

// ---------------------------------------------------------------------------
// 4. Dashboard — grid of widgets. Cells reference vetted primitive kinds.
// ---------------------------------------------------------------------------

/**
 * Kinds the dashboard may reference. Keep narrow — these are the
 * 36 typed primitives in `packages/genui/src/registry.ts`. The full
 * `AgUiUiPart` payload is validated separately by `PART_SCHEMAS`
 * when the cell renders. Here we only check the kind name is known.
 */
export const PORTAL_DASHBOARD_KINDS = [
  'chart-vega',
  'data-table',
  'timeline',
  'kpi-grid',
  'prefill-form',
  'approval',
  'workflow',
  'map',
  'calendar',
  'file-preview',
  'kanban',
  'dashboard-grid',
  'heatmap',
  'markdown-card',
  'prompt-suggestions',
  'evidence-card',
  'tree',
  'diff-view',
  'gauge',
  'metric-sparkline',
  'image-annotation',
  'signature-pad',
  'pdf-viewer',
  'slider-input',
  'multistep-wizard',
  'media-grid',
  'chat-embed',
  'live-counter',
  'org-chart',
  'comparison-table',
  'geo-fence',
  'notification-toast',
  'decision-trace',
  'code-block',
  'dataflow-diagram',
] as const;

export type PortalDashboardKind = (typeof PORTAL_DASHBOARD_KINDS)[number];

export const PortalDashboardKindSchema = z.enum(PORTAL_DASHBOARD_KINDS);

export const PortalDashboardCellSchema = z
  .object({
    id: z.string().min(1).max(120),
    /** Tailwind-grid 12-column span. */
    span: z.number().int().min(1).max(12),
    /** The primitive kind. Payload validation deferred to PART_SCHEMAS. */
    kind: PortalDashboardKindSchema,
    /**
     * Initial props passed to the primitive on first render. `null`
     * means the cell is a placeholder filled at render-time by a
     * server data hook (e.g. live KPIs).
     */
    initialProps: z.record(z.unknown()).nullable(),
    /** Optional persona-friendly title shown above the cell. */
    title: z.string().max(120).optional(),
    /** Optional feature flag gate. */
    featureFlag: z.string().max(120).optional(),
  })
  .strict();

export const PortalDashboardSchema = z
  .object({
    /** 12 = full row. Cells layout left→right; row breaks computed at render. */
    columns: z.literal(12),
    cells: z.array(PortalDashboardCellSchema).min(1).max(48),
  })
  .strict();

export type PortalDashboard = z.infer<typeof PortalDashboardSchema>;

// ---------------------------------------------------------------------------
// 5. Primary action — the FAB-style action button visible on home.
// ---------------------------------------------------------------------------

export const PortalPrimaryActionSchema = z
  .object({
    label: z.string().min(1).max(40),
    intent: PortalPrimaryIntentSchema,
    /** Optional Lucide icon name (whitelisted at render). */
    icon: z.string().max(60).optional(),
  })
  .strict();

export type PortalPrimaryAction = z.infer<typeof PortalPrimaryActionSchema>;

// ---------------------------------------------------------------------------
// 6. Theme — token overrides only (no inline CSS or raw className).
// ---------------------------------------------------------------------------

/**
 * Whitelisted token keys. Mirrors `packages/design-system/src/styles/`
 * semantic layer (Wave 29 Midnight Ledger + Cinematic Display
 * direction). Persona-specific overrides land here.
 */
export const PORTAL_THEME_TOKEN_KEYS = [
  'color-bg',
  'color-surface',
  'color-text',
  'color-muted',
  'color-primary',
  'color-success',
  'color-warning',
  'color-danger',
  'color-accent',
  'density',
  'radius',
  'font-display',
  'font-body',
] as const;

export type PortalThemeTokenKey = (typeof PORTAL_THEME_TOKEN_KEYS)[number];

export const PortalThemeSchema = z
  .object({
    /** Base mode for the persona — light, dark, or system-following. */
    mode: z.enum(['light', 'dark', 'system']),
    /** Density — compact (ops surfaces) vs comfortable (tenant). */
    density: z.enum(['compact', 'comfortable']),
    /** OKLCH or CSS variable overrides keyed by whitelisted tokens. */
    tokens: z
      .record(z.enum(PORTAL_THEME_TOKEN_KEYS), z.string().min(1).max(120))
      .optional(),
  })
  .strict();

export type PortalTheme = z.infer<typeof PortalThemeSchema>;

// ---------------------------------------------------------------------------
// 7. Feature flags — per-layout overrides on top of tenant flags.
// ---------------------------------------------------------------------------

export const PortalFeatureFlagsSchema = z
  .record(z.string().min(1).max(120), z.boolean())
  .refine((rec) => Object.keys(rec).length <= 64, {
    message: 'max 64 feature flags per layout',
  });

export type PortalFeatureFlags = z.infer<typeof PortalFeatureFlagsSchema>;

// ---------------------------------------------------------------------------
// 8. Accessibility — per-user adaptive surface preferences.
// ---------------------------------------------------------------------------

export const PortalAccessibilityProfileSchema = z
  .object({
    largeText: z.boolean(),
    highContrast: z.boolean(),
    reduceMotion: z.boolean(),
    screenReaderOptimized: z.boolean(),
    /** Voice-first surface override; swaps layout to chat-embed-led. */
    voiceFirst: z.boolean(),
    /** Primary input modality the user prefers. */
    primaryModality: z.enum(['voice', 'text', 'touch', 'hybrid']),
  })
  .strict();

export type PortalAccessibilityProfile = z.infer<
  typeof PortalAccessibilityProfileSchema
>;

// ---------------------------------------------------------------------------
// 9. Audit — provenance for governance.
// ---------------------------------------------------------------------------

export const PortalLayoutAuditEntrySchema = z
  .object({
    actor: z.enum(['system', 'user', 'agent', 'admin']),
    actorId: z.string().min(1).max(120),
    action: z.enum(['created', 'edited', 'forked', 'reset', 'imported']),
    at: Iso8601Schema,
    /** Optional rationale or chat-turn reference. */
    note: z.string().max(500).optional(),
  })
  .strict();

export const PortalLayoutAuditSchema = z
  .object({
    createdBy: z.string().min(1).max(120),
    updatedBy: z.string().min(1).max(120),
    /** Ring-buffer style log — capped to last 50 events. */
    history: z.array(PortalLayoutAuditEntrySchema).max(50),
  })
  .strict();

export type PortalLayoutAudit = z.infer<typeof PortalLayoutAuditSchema>;

// ---------------------------------------------------------------------------
// 10. PortalLayout — the document.
// ---------------------------------------------------------------------------

export const PORTAL_LAYOUT_SCHEMA_VERSION = 1;

export const PortalLayoutSchema = z
  .object({
    /** ULID or UUID, opaque to the client. */
    id: z.string().min(1).max(120),
    /** Schema version for forward-compat document migration. */
    version: z.literal(PORTAL_LAYOUT_SCHEMA_VERSION),
    /** Which persona this layout is for. Determines seed lineage. */
    personaId: PortalPersonaSchema,
    /** User this layout belongs to. `null` means tenant-default. */
    userId: z.string().min(1).max(120).nullable(),
    /** Tenant scope. Always present — platform defaults are NOT here. */
    tenantId: z.string().min(1).max(120),
    topbar: PortalTopbarSchema,
    sidebar: PortalSidebarSchema,
    dashboard: PortalDashboardSchema,
    primaryAction: PortalPrimaryActionSchema,
    theme: PortalThemeSchema,
    featureFlags: PortalFeatureFlagsSchema,
    accessibilityProfile: PortalAccessibilityProfileSchema,
    /** Optional pointer to the parent layout this was forked from. */
    parentLayoutId: z.string().min(1).max(120).optional(),
    audit: PortalLayoutAuditSchema,
    createdAt: Iso8601Schema,
    updatedAt: Iso8601Schema,
  })
  .strict();

export type PortalLayout = z.infer<typeof PortalLayoutSchema>;

// ---------------------------------------------------------------------------
// 11. Seed shape — what `./seeds/*.json` declare.
// ---------------------------------------------------------------------------

/**
 * Seeds are layout templates without `id`/`tenantId`/`userId`/audit/
 * timestamps. Those get filled at fork time by the resolver. Keeps
 * the seed JSON shape small + reviewable.
 */
export const PortalLayoutSeedSchema = z
  .object({
    version: z.literal(PORTAL_LAYOUT_SCHEMA_VERSION),
    personaId: PortalPersonaSchema,
    topbar: PortalTopbarSchema,
    sidebar: PortalSidebarSchema,
    dashboard: PortalDashboardSchema,
    primaryAction: PortalPrimaryActionSchema,
    theme: PortalThemeSchema,
    featureFlags: PortalFeatureFlagsSchema,
    accessibilityProfile: PortalAccessibilityProfileSchema,
  })
  .strict();

export type PortalLayoutSeed = z.infer<typeof PortalLayoutSeedSchema>;

// ---------------------------------------------------------------------------
// 12. Helpers — fork seed → layout, validate, defaults.
// ---------------------------------------------------------------------------

export interface ForkSeedInput {
  readonly seed: PortalLayoutSeed;
  readonly id: string;
  readonly tenantId: string;
  /** `null` for tenant-default layout; otherwise the user the doc belongs to. */
  readonly userId: string | null;
  readonly actorId: string;
  readonly parentLayoutId?: string;
  /** Defaults to `new Date().toISOString()` — passed in for determinism. */
  readonly nowIso?: string;
}

/**
 * Materialise a `PortalLayout` from a seed by attaching identity +
 * audit metadata. Pure — no side effects; safe to call client or
 * server side.
 */
export function forkSeedIntoLayout(input: ForkSeedInput): PortalLayout {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const layout: PortalLayout = {
    id: input.id,
    version: PORTAL_LAYOUT_SCHEMA_VERSION,
    personaId: input.seed.personaId,
    userId: input.userId,
    tenantId: input.tenantId,
    topbar: input.seed.topbar,
    sidebar: input.seed.sidebar,
    dashboard: input.seed.dashboard,
    primaryAction: input.seed.primaryAction,
    theme: input.seed.theme,
    featureFlags: input.seed.featureFlags,
    accessibilityProfile: input.seed.accessibilityProfile,
    ...(input.parentLayoutId !== undefined
      ? { parentLayoutId: input.parentLayoutId }
      : {}),
    audit: {
      createdBy: input.actorId,
      updatedBy: input.actorId,
      history: [
        {
          actor: 'system',
          actorId: input.actorId,
          action: 'created',
          at: nowIso,
          note: `Forked from ${input.seed.personaId} seed`,
        },
      ],
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  // Belt + suspenders — validate the fork output before returning.
  return PortalLayoutSchema.parse(layout);
}

/** Defensive validate — returns the parsed layout or throws. */
export function parsePortalLayout(input: unknown): PortalLayout {
  return PortalLayoutSchema.parse(input);
}

/** Non-throwing variant — returns `null` on schema failure. */
export function safeParsePortalLayout(input: unknown): PortalLayout | null {
  const result = PortalLayoutSchema.safeParse(input);
  return result.success ? result.data : null;
}
