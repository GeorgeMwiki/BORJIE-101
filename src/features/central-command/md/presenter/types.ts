/**
 * Inline-Chat Data Presenter — Types.
 *
 * The Managing Director platform ships a "owner never leaves chat"
 * promise. The presenter turns an owner's natural-language ask into a
 * typed `InlineDataRequest`, fetches the underlying rows from Supabase
 * (tier-scoped + RLS), and emits a `GenerativeUiSpec` that the closed
 * registry in `@/core/brain/generative-ui` already knows how to render
 * inline in the chat stream.
 *
 * All public types are read-only — every transformation creates a new
 * object (project-wide immutability policy). All requests round-trip
 * through Zod so an LLM-classified intent can never produce a malformed
 * subject or filter map.
 *
 * @module features/central-command/md/presenter/types
 */

import { z } from "zod";
import type { BorjieAITier } from "@/core/governance/tier-policy";

// ---------------------------------------------------------------------------
// Owner-style hints
// ---------------------------------------------------------------------------

/**
 * The owner-style profile drives presentation density. A terse owner
 * wants a compact table with the minimal columns; a verbose owner
 * wants charts + narrative around the same data. We propagate the
 * hint forward so the tinter at the end of the pipeline can adapt the
 * spec without reaching back into the request.
 */
export const OwnerStyleHintSchema = z.enum(["terse", "balanced", "verbose"]);

export type OwnerStyleHint = z.infer<typeof OwnerStyleHintSchema>;

// ---------------------------------------------------------------------------
// Inline data kinds
// ---------------------------------------------------------------------------

/**
 * The six surfaces the inline presenter supports. Each one maps to one
 * or more `kind`s in the generative-UI registry:
 *
 *   - "table"        → `table`
 *   - "chart"        → `chart.recharts.timeseries`
 *   - "metric-grid"  → `metric.grid`
 *   - "file-preview" → `markdown` (PDF/image embedded)
 *   - "diagram"      → `mermaid`
 *   - "form"         → `form` (capture-style asks, e.g. "log a new hire")
 */
export const InlineDataKindSchema = z.enum([
  "table",
  "chart",
  "metric-grid",
  "file-preview",
  "diagram",
  "form",
]);

export type InlineDataKind = z.infer<typeof InlineDataKindSchema>;

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

/**
 * The subjects the presenter can resolve to a Supabase data source. The
 * intent-parser classifies the owner's text into one of these; anything
 * outside the list is rejected by Zod and the presenter returns null
 * (chat falls back to plain-text response).
 *
 * Keep this list narrow on purpose: every new subject must add a
 * fetcher + a spec-builder branch, and a corresponding fixture in the
 * intent-parser test suite.
 */
export const InlineDataSubjectSchema = z.enum([
  "employees",
  "team",
  "customers",
  "top-customer",
  "sales-trend",
  "revenue",
  "cash-position",
  "supplier-contract",
  "org-chart",
  "kpi-summary",
  "expenses",
  "outstanding-invoices",
  "pending-approvals",
]);

export type InlineDataSubject = z.infer<typeof InlineDataSubjectSchema>;

// ---------------------------------------------------------------------------
// InlineDataRequest — the contract the intent-parser produces and the
// fetcher + spec-builder consume.
// ---------------------------------------------------------------------------

const FilterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(200), z.number()])).max(50),
]);

export const InlineDataRequestSchema = z.object({
  kind: InlineDataKindSchema,
  subject: InlineDataSubjectSchema,
  /**
   * Free-form filters scoped to the subject. The fetcher decides
   * which keys are honoured per subject (others are ignored).
   * Examples: `{ since: "2026-01-01" }`, `{ role: "engineer" }`.
   */
  filters: z.record(z.string().min(1).max(64), FilterValueSchema).optional(),
  /**
   * Optional inline title override. When omitted, the spec-builder
   * derives one from the subject + filters.
   */
  titleHint: z.string().max(200).optional(),
  /**
   * Style hint passed through from the owner profile. The tinter
   * uses this; the fetcher and spec-builder ignore it.
   */
  ownerStyleHint: OwnerStyleHintSchema.optional(),
});

export type InlineDataRequest = z.infer<typeof InlineDataRequestSchema>;

// ---------------------------------------------------------------------------
// Context — what the service needs at runtime
// ---------------------------------------------------------------------------

export interface PresenterContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly tier: BorjieAITier;
  readonly correlationId: string;
  readonly sessionId: string;
  /**
   * Caller-provided owner-style hint (e.g. from the owner-profile
   * agent). The presenter respects this when set; otherwise the
   * intent-parser may infer a hint from the text style.
   */
  readonly ownerStyleHint?: OwnerStyleHint;
}

// ---------------------------------------------------------------------------
// Row shapes returned by the fetcher
// ---------------------------------------------------------------------------

/**
 * The fetcher is intentionally typed loosely (`unknown`) at the
 * JSON-value level — the spec-builder narrows per subject. All values
 * MUST be JSON-primitives (string / number / boolean / null) so the
 * downstream `TableSpec` row schema accepts them without coercion.
 */
export type InlineDataRow = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface InlineDataFetchResult {
  readonly subject: InlineDataSubject;
  readonly rows: ReadonlyArray<InlineDataRow>;
  /** ISO timestamp of when the rows were materialised. */
  readonly generatedAt: string;
  /** Optional source query hash for cache-busting + source-trail UI. */
  readonly sourceQueryHash?: string;
  /** Per-fetch tier — surfaces in the spec's source trail. */
  readonly tier: BorjieAITier;
  /** Time-series compatible variant — populated when subject is a series. */
  readonly series?: ReadonlyArray<{
    readonly name: string;
    readonly data: ReadonlyArray<{ readonly t: string; readonly y: number }>;
  }>;
  /** Metric grid variant — populated when subject is `kpi-summary`. */
  readonly metrics?: ReadonlyArray<{
    readonly label: string;
    readonly value: string | number;
    readonly delta?: number;
    readonly trend?: "up" | "down" | "flat";
    readonly unit?: string;
  }>;
  /** File-preview variant — populated when subject is `supplier-contract`. */
  readonly file?: {
    readonly storagePath: string;
    readonly mimeType: string;
    readonly displayName: string;
    readonly signedUrl?: string;
  };
  /** Org-chart variant — populated when subject is `org-chart`. */
  readonly orgChart?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly managerId: string | null;
  }>;
}
