/**
 * Public types for `@borjie/portal-genui`.
 *
 * EXTENDS — does not replace — the `PortalLayout` document defined in
 * `packages/genui/src/document.ts`. The existing schema covers the
 * frame (topbar, sidebar, dashboard cells, primary action, theme,
 * a11y) but is intentionally narrow on dashboard cells: cells must
 * reference one of the 35 vetted primitive kinds and carry static
 * `initialProps` only. That works great for hand-authored seeds.
 *
 * It does NOT cover the user vision the brain needs to support: a
 * user chats "I need to track our staff payroll" and the AI mints a
 * brand-new HR tab with arbitrary fields, sections, widgets, and the
 * tenant's persisted records flowing into them on the next login.
 *
 * The shape we add here:
 *
 *   - PortalTabSchema  — the document for ONE tab (name, icon,
 *                        sections of fields + widgets + permissions).
 *   - PortalTabSection — a vertical band inside a tab. Fields render
 *                        as a labelled column; widgets render below.
 *   - PortalTabField   — a labelled, validated form-style input.
 *                        Type comes from the field-type catalog
 *                        (`./fields`). 22 types out-of-box.
 *   - PortalTabWidget  — a self-contained data widget (table, kpi,
 *                        timeline, kanban, chart...). 10 widget kinds
 *                        out-of-box.
 *   - TabGenerationIntent — the intent-detector's output describing
 *                        "user is asking for an X tab".
 *
 * Persistence: stored in the `portal_tabs` table (migration 0173).
 * The shape is JSONB with a typed (tenant_id, persona_id, user_id,
 * tab_key) header so existing RLS patterns translate.
 *
 * The whole module is pure / serializable — no React refs, no
 * functions, no class instances.
 */

import { z } from 'zod';

/**
 * Mirrors `PORTAL_DASHBOARD_KINDS` from `@borjie/genui/document.ts`.
 * We re-declare here rather than importing because the `genui` package
 * re-exports React components from its `index.ts`, which would force
 * this Node-only package to enable JSX. Tests
 * (`portal-genui-dashboard-kinds-mirror.test.ts`) lock both lists in
 * sync.
 */
export const PORTAL_DASHBOARD_KIND_NAMES = [
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

export type PortalDashboardKindName = (typeof PORTAL_DASHBOARD_KIND_NAMES)[number];

const PortalDashboardKindSchema = z.enum(PORTAL_DASHBOARD_KIND_NAMES);

// ---------------------------------------------------------------------------
// 1. ISO + ids
// ---------------------------------------------------------------------------

const Iso8601Schema = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'must be ISO-8601 parseable');

/** Stable tab key used for routing / persistence (e.g. `hr.payroll`). */
const TabKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z][a-z0-9._-]*$/,
    'tab key must be lowercase letters / digits / . _ -',
  );

// ---------------------------------------------------------------------------
// 2. Field types — the dynamic field catalog.
// ---------------------------------------------------------------------------

/**
 * 22 supported field kinds. The renderer maps each kind to a React
 * component (`./fields/registry.ts`). Adding a new kind requires a
 * registry entry + a renderer + a validator. Keep narrow on purpose;
 * unknown kinds get rejected at parse time so a buggy LLM output
 * cannot ship.
 */
export const PORTAL_TAB_FIELD_KINDS = [
  'text',
  'long_text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'dropdown',
  'multi_select',
  'checkbox',
  'toggle',
  'file_upload',
  'image_upload',
  'signature',
  'address_with_map',
  'audio_note',
  'phone_number',
  'email',
  'url',
  'json',
  'rating',
  'color',
] as const;

export type PortalTabFieldKind = (typeof PORTAL_TAB_FIELD_KINDS)[number];

export const PortalTabFieldKindSchema = z.enum(PORTAL_TAB_FIELD_KINDS);

/**
 * Single field on a tab. `key` is stable; `label` is presentational.
 * Validation knobs are kind-specific but kept narrow so the LLM
 * cannot smuggle in arbitrary regex/JS.
 */
export const PortalTabFieldSchema = z
  .object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    kind: PortalTabFieldKindSchema,
    /** Help text shown under the label. */
    help: z.string().max(500).optional(),
    /** Required at write time. Default false. */
    required: z.boolean().optional(),
    /** Read-only — value comes from the system / agent. */
    readonly: z.boolean().optional(),
    /** Default value for new records. Kind-specific shape; widened. */
    default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    /**
     * For `dropdown` / `multi_select`. Each option carries a stable
     * value + a label. Empty list rejected — use a different kind.
     */
    options: z
      .array(
        z
          .object({
            value: z.string().min(1).max(120),
            label: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .optional(),
    /** Numeric / currency / percent / rating min. */
    min: z.number().optional(),
    /** Numeric / currency / percent / rating max. */
    max: z.number().optional(),
    /** Number of decimal places for `number`/`currency`/`percent`. */
    precision: z.number().int().min(0).max(8).optional(),
    /** Currency ISO 4217 for `currency` kind. Defaults to tenant default. */
    currencyCode: z.string().length(3).optional(),
    /** Allowed MIME types for `file_upload` / `image_upload`. */
    accept: z.array(z.string().min(1).max(120)).max(50).optional(),
    /** Optional placeholder. */
    placeholder: z.string().max(200).optional(),
    /** Whether the field is hidden in list views. */
    hiddenInList: z.boolean().optional(),
    /** Render width hint, 1-12 (Tailwind grid). Default 6. */
    span: z.number().int().min(1).max(12).optional(),
  })
  .strict();

export type PortalTabField = z.infer<typeof PortalTabFieldSchema>;

// ---------------------------------------------------------------------------
// 3. Widget kinds — the dynamic widget catalog.
// ---------------------------------------------------------------------------

/**
 * 10 supported widget kinds, plus the escape hatch `genui_part` which
 * forwards to one of the 35 PortalLayout primitive kinds from the
 * existing `@borjie/genui` package. This lets a generated tab
 * embed any vetted AG-UI part without duplicating its schema here.
 */
export const PORTAL_TAB_WIDGET_KINDS = [
  'kpi_card',
  'timeline',
  'table',
  'map',
  'gallery',
  'form',
  'chart_line',
  'chart_bar',
  'chart_donut',
  'gauge',
  'calendar',
  'kanban',
  'chat',
  'genui_part',
] as const;

export type PortalTabWidgetKind = (typeof PORTAL_TAB_WIDGET_KINDS)[number];

export const PortalTabWidgetKindSchema = z.enum(PORTAL_TAB_WIDGET_KINDS);

export const PortalTabWidgetSchema = z
  .object({
    key: z.string().min(1).max(120),
    kind: PortalTabWidgetKindSchema,
    title: z.string().min(1).max(200),
    /** Optional subtitle / description shown under the title. */
    subtitle: z.string().max(500).optional(),
    /** Tailwind-grid 12-column span. Default 6. */
    span: z.number().int().min(1).max(12).optional(),
    /**
     * Initial config / props passed to the renderer. Free shape but
     * capped on depth via the global JSON parser. NULL means the
     * widget is a placeholder filled in at render time by a server
     * data hook.
     */
    config: z.record(z.unknown()).nullable(),
    /**
     * When `kind === 'genui_part'` this MUST be a valid PortalDashboard
     * primitive kind. Lets the generated tab leverage the 35 vetted
     * AG-UI primitives without re-declaring their schemas.
     */
    genuiKind: PortalDashboardKindSchema.optional(),
  })
  .strict()
  .superRefine((widget, ctx) => {
    if (widget.kind === 'genui_part' && !widget.genuiKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'widget.kind === "genui_part" requires a `genuiKind` from PORTAL_DASHBOARD_KINDS',
        path: ['genuiKind'],
      });
    }
  });

export type PortalTabWidget = z.infer<typeof PortalTabWidgetSchema>;

// ---------------------------------------------------------------------------
// 4. Sections — vertical bands inside a tab.
// ---------------------------------------------------------------------------

export const PortalTabSectionSchema = z
  .object({
    key: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    /** Fields rendered as a labelled grid above the widgets. */
    fields: z.array(PortalTabFieldSchema).max(40),
    /** Widgets rendered below the fields. */
    widgets: z.array(PortalTabWidgetSchema).max(20),
    /** Collapse the section by default. */
    defaultCollapsed: z.boolean().optional(),
  })
  .strict()
  .superRefine((section, ctx) => {
    if (section.fields.length === 0 && section.widgets.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'section must declare at least one field or widget',
        path: [],
      });
    }
  });

export type PortalTabSection = z.infer<typeof PortalTabSectionSchema>;

// ---------------------------------------------------------------------------
// 5. Permissions — coarse role-gating on the whole tab.
// ---------------------------------------------------------------------------

/**
 * Reuses the persona vocabulary from the existing PortalLayout so a
 * generated tab can be visible only to e.g. `internal_admin` and
 * `property_manager`. Tab-level only — field-level perms are owned
 * by the row-level repository, not the schema.
 */
export const PortalTabPermissionsSchema = z
  .object({
    visibleToPersonas: z
      .array(
        z.enum([
          'internal_admin',
          'property_manager',
          'estate_manager',
          'owner',
          'customer',
        ]),
      )
      .min(1)
      .max(5),
    /** When true, only the tab owner can edit (others read-only). */
    ownerOnlyEdits: z.boolean().optional(),
  })
  .strict();

export type PortalTabPermissions = z.infer<typeof PortalTabPermissionsSchema>;

// ---------------------------------------------------------------------------
// 6. Audit — same provenance pattern as PortalLayout.
// ---------------------------------------------------------------------------

export const PortalTabAuditEntrySchema = z
  .object({
    actor: z.enum(['system', 'user', 'agent', 'admin']),
    actorId: z.string().min(1).max(120),
    action: z.enum(['created', 'edited', 'imported', 'reset', 'deleted']),
    at: Iso8601Schema,
    note: z.string().max(500).optional(),
  })
  .strict();

export const PortalTabAuditSchema = z
  .object({
    createdBy: z.string().min(1).max(120),
    updatedBy: z.string().min(1).max(120),
    /** Last-50 ring-buffer. */
    history: z.array(PortalTabAuditEntrySchema).max(50),
    /**
     * Optional pointer to the chat turn / conversation that minted
     * this tab. Lets the UI surface "Why does this exist?" cards.
     */
    sourceConversationId: z.string().max(200).optional(),
  })
  .strict();

export type PortalTabAudit = z.infer<typeof PortalTabAuditSchema>;

// ---------------------------------------------------------------------------
// 7. The tab document itself.
// ---------------------------------------------------------------------------

export const PORTAL_TAB_SCHEMA_VERSION = 1;

export const PortalTabSchema = z
  .object({
    id: z.string().min(1).max(120),
    version: z.literal(PORTAL_TAB_SCHEMA_VERSION),
    /** Tenant scope — always present; platform-default tabs are not stored here. */
    tenantId: z.string().min(1).max(120),
    /** Owning user — NULL means tenant-default tab visible to the persona set. */
    userId: z.string().min(1).max(120).nullable(),
    /** Stable key used for routing / link-to. */
    tabKey: TabKeySchema,
    /** Display name shown on the sidebar + tab header. */
    title: z.string().min(1).max(120),
    /** One-line description used in tooltips + the AI's preview card. */
    description: z.string().max(500),
    /** Lucide icon name — whitelisted at render. */
    icon: z.string().max(60),
    /** Domain — HR / Finance / Compliance / Procurement / Custom. */
    domain: z.enum([
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
    ]),
    sections: z.array(PortalTabSectionSchema).min(1).max(20),
    permissions: PortalTabPermissionsSchema,
    audit: PortalTabAuditSchema,
    createdAt: Iso8601Schema,
    updatedAt: Iso8601Schema,
  })
  .strict()
  .superRefine((tab, ctx) => {
    // All field keys must be unique within the tab so the
    // record-per-tab payload has unambiguous lookup keys.
    const seen = new Set<string>();
    for (const section of tab.sections) {
      for (const field of section.fields) {
        const key = `${section.key}.${field.key}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate field key '${field.key}' in section '${section.key}'`,
            path: ['sections'],
          });
        }
        seen.add(key);
      }
    }
  });

export type PortalTab = z.infer<typeof PortalTabSchema>;

// ---------------------------------------------------------------------------
// 8. Intent detection types.
// ---------------------------------------------------------------------------

/** Output of the intent detector — fed straight into the generator. */
export interface TabGenerationIntent {
  /** Stable proposed tab key. Free of spaces; lowercased. */
  readonly proposedTabKey: string;
  /** Display name proposed for the tab. */
  readonly proposedTabTitle: string;
  /** Detected domain bucket — drives the generator's prompt skeleton. */
  readonly domain: PortalTab['domain'];
  /** Confidence [0, 1] in the classification. */
  readonly confidence: number;
  /** Evidence — the phrases the classifier latched onto. */
  readonly evidence: ReadonlyArray<string>;
  /**
   * The original user message (truncated to 2 KB) so downstream
   * generation can quote it back to the user without re-fetching.
   */
  readonly sourceMessage: string;
  /**
   * Set by the detector when it routed through the multi-LLM
   * synthesizer because heuristics were ambiguous.
   */
  readonly usedLlm: boolean;
}

export const TabGenerationIntentSchema = z
  .object({
    proposedTabKey: TabKeySchema,
    proposedTabTitle: z.string().min(1).max(120),
    domain: z.enum([
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
    ]),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().min(1).max(200)).max(10),
    sourceMessage: z.string().min(1).max(2048),
    usedLlm: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// 9. Generation input + helpers
// ---------------------------------------------------------------------------

/**
 * Optional tenant context the generator can fold into its prompt.
 * Everything is opt-in; an empty `{}` is a valid call.
 */
export interface GeneratorOrgContext {
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly tenantRegion?: string;
  readonly tenantCurrency?: string;
  readonly userPersona?:
    | 'internal_admin'
    | 'property_manager'
    | 'estate_manager'
    | 'owner'
    | 'customer';
  readonly existingTabKeys?: ReadonlyArray<string>;
}

/** Defensive validate — returns the parsed tab or throws. */
export function parsePortalTab(input: unknown): PortalTab {
  return PortalTabSchema.parse(input);
}

/** Non-throwing variant — returns `null` on schema failure. */
export function safeParsePortalTab(input: unknown): PortalTab | null {
  const result = PortalTabSchema.safeParse(input);
  return result.success ? result.data : null;
}
