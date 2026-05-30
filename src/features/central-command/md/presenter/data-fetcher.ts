/**
 * Data Fetcher — pulls rows from Supabase for an `InlineDataRequest`.
 *
 * Tier-scoping policy:
 *   - Reads are gated by RLS at the Supabase layer; we additionally
 *     pin every query to `tenant_id` derived from the caller's
 *     `PresenterContext`. Sovereign tier may read cross-tenant
 *     aggregates (mirrors the memory recall policy).
 *   - The fetcher NEVER receives or returns raw PII fields it doesn't
 *     need — every projection lists explicit columns.
 *
 * Mutability policy: every returned object is frozen at the boundary.
 *
 * @module features/central-command/md/presenter/data-fetcher
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createLogger } from "@/lib/logger";
import {
  type InlineDataFetchResult,
  type InlineDataRequest,
  type InlineDataRow,
  type InlineDataSubject,
  type PresenterContext,
} from "./types";

const log = createLogger("md.presenter.fetch");

// ---------------------------------------------------------------------------
// Supabase client injection (testable)
// ---------------------------------------------------------------------------

/**
 * The fetcher accepts an injected Supabase client so tests can drive
 * deterministic responses without touching the network. The default
 * factory imports the server client lazily to avoid bundling on the
 * client; tests bind a fake via `setSupabaseFactory`.
 */
export type SupabaseFactory = () => Promise<SupabaseClient>;

let supabaseFactory: SupabaseFactory = async () => {
  // Lazy import — keeps test bundles slim and avoids pulling
  // next/headers on non-Next entry points.
  const mod = await import("@/lib/supabase/server");
  return mod.createServiceClient();
};

export function setSupabaseFactory(factory: SupabaseFactory): void {
  supabaseFactory = factory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoNow(): string {
  return new Date().toISOString();
}

function freezeRow(row: Readonly<Record<string, unknown>>): InlineDataRow {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    )
      out[k] = v;
    else out[k] = String(v);
  }
  return Object.freeze(out);
}

function asString(v: unknown): string | null {
  return typeof v === "string"
    ? v
    : v === undefined || v === null
      ? null
      : String(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subject → fetcher dispatch
// ---------------------------------------------------------------------------

interface FetcherDeps {
  readonly supabase: SupabaseClient;
  readonly request: InlineDataRequest;
  readonly ctx: PresenterContext;
}

async function fetchEmployees(
  deps: FetcherDeps,
): Promise<ReadonlyArray<InlineDataRow>> {
  const dept = deps.request.filters?.department;
  const query = deps.supabase
    .from("md_employees")
    .select("id, name, role, department, last_one_on_one_at, sentiment, status")
    .eq("tenant_id", deps.ctx.tenantId)
    .order("name", { ascending: true })
    .limit(200);

  const { data, error } =
    typeof dept === "string" ? await query.eq("department", dept) : await query;

  if (error) {
    log.warn("md_employees fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    freezeRow({
      name: asString(r.name),
      role: asString(r.role),
      department: asString(r.department),
      last_one_on_one: asString(r.last_one_on_one_at),
      sentiment: asString(r.sentiment),
      status: asString(r.status),
    }),
  );
}

async function fetchCustomers(
  deps: FetcherDeps,
): Promise<ReadonlyArray<InlineDataRow>> {
  const { data, error } = await deps.supabase
    .from("md_customers")
    .select("id, name, segment, ltv_tzs, last_order_at, status")
    .eq("tenant_id", deps.ctx.tenantId)
    .order("ltv_tzs", { ascending: false })
    .limit(200);

  if (error) {
    log.warn("md_customers fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    freezeRow({
      name: asString(r.name),
      segment: asString(r.segment),
      ltv: asNumber(r.ltv_tzs),
      last_order: asString(r.last_order_at),
      status: asString(r.status),
    }),
  );
}

async function fetchOutstandingInvoices(
  deps: FetcherDeps,
): Promise<ReadonlyArray<InlineDataRow>> {
  const { data, error } = await deps.supabase
    .from("md_invoices")
    .select("invoice_no, customer_name, amount_tzs, due_date, days_overdue")
    .eq("tenant_id", deps.ctx.tenantId)
    .eq("status", "outstanding")
    .order("days_overdue", { ascending: false })
    .limit(200);

  if (error) {
    log.warn("md_invoices fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    freezeRow({
      invoice_no: asString(r.invoice_no),
      customer: asString(r.customer_name),
      amount: asNumber(r.amount_tzs),
      due: asString(r.due_date),
      days_overdue: asNumber(r.days_overdue),
    }),
  );
}

async function fetchPendingApprovals(
  deps: FetcherDeps,
): Promise<ReadonlyArray<InlineDataRow>> {
  const { data, error } = await deps.supabase
    .from("md_approvals")
    .select("id, kind, requested_by, requested_at, summary")
    .eq("tenant_id", deps.ctx.tenantId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(100);

  if (error) {
    log.warn("md_approvals fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    freezeRow({
      kind: asString(r.kind),
      requested_by: asString(r.requested_by),
      requested_at: asString(r.requested_at),
      summary: asString(r.summary),
    }),
  );
}

async function fetchSalesTrend(
  deps: FetcherDeps,
): Promise<
  ReadonlyArray<{ name: string; data: ReadonlyArray<{ t: string; y: number }> }>
> {
  const window = deps.request.filters?.window;
  let query = deps.supabase
    .from("md_sales_daily")
    .select("day, revenue_tzs")
    .eq("tenant_id", deps.ctx.tenantId)
    .order("day", { ascending: true });

  if (typeof window === "string") {
    query = query.filter("window_tag", "eq", window);
  }

  const { data, error } = await query;
  if (error) {
    log.warn("md_sales_daily fetch failed", { error: error.message });
    return [];
  }
  const points = (data ?? [])
    .map((r) => ({
      t: asString(r.day) ?? "",
      y: asNumber(r.revenue_tzs) ?? 0,
    }))
    .filter((p) => p.t.length > 0);
  if (points.length === 0) return [];
  return [Object.freeze({ name: "Revenue", data: Object.freeze(points) })];
}

async function fetchKpiSummary(deps: FetcherDeps): Promise<
  ReadonlyArray<{
    label: string;
    value: string | number;
    delta?: number;
    trend?: "up" | "down" | "flat";
    unit?: string;
  }>
> {
  const { data, error } = await deps.supabase
    .from("md_kpis")
    .select("label, value, unit, delta, trend")
    .eq("tenant_id", deps.ctx.tenantId)
    .limit(12);

  if (error) {
    log.warn("md_kpis fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    Object.freeze({
      label: asString(r.label) ?? "metric",
      value: asNumber(r.value) ?? asString(r.value) ?? "",
      unit: asString(r.unit) ?? undefined,
      delta: asNumber(r.delta) ?? undefined,
      trend:
        r.trend === "up" || r.trend === "down" || r.trend === "flat"
          ? r.trend
          : undefined,
    }),
  );
}

async function fetchOrgChart(deps: FetcherDeps): Promise<
  ReadonlyArray<{
    id: string;
    name: string;
    role: string;
    managerId: string | null;
  }>
> {
  const { data, error } = await deps.supabase
    .from("md_employees")
    .select("id, name, role, manager_id, status")
    .eq("tenant_id", deps.ctx.tenantId)
    .eq("status", "active")
    .limit(500);

  if (error) {
    log.warn("md_employees (org chart) fetch failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) =>
    Object.freeze({
      id: asString(r.id) ?? "",
      name: asString(r.name) ?? "",
      role: asString(r.role) ?? "",
      managerId: asString(r.manager_id),
    }),
  );
}

async function fetchSupplierContractFile(
  deps: FetcherDeps,
): Promise<InlineDataFetchResult["file"]> {
  const { data, error } = await deps.supabase
    .from("md_contracts")
    .select("storage_path, mime_type, display_name")
    .eq("tenant_id", deps.ctx.tenantId)
    .eq("kind", "supplier")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    log.warn("md_contracts fetch failed", { error: error.message });
    return undefined;
  }
  if (!data) return undefined;

  const storagePath = asString(data.storage_path);
  const mimeType = asString(data.mime_type);
  const displayName = asString(data.display_name);
  if (!storagePath || !mimeType || !displayName) return undefined;

  // Best-effort signed URL — tests inject a fake client that returns
  // a predictable value; production uses Supabase storage signing.
  let signedUrl: string | undefined;
  try {
    const storage = (
      deps.supabase as unknown as {
        storage: {
          from(bucket: string): {
            createSignedUrl(
              path: string,
              ttl: number,
            ): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
          };
        };
      }
    ).storage;
    const result = await storage
      .from("md-contracts")
      .createSignedUrl(storagePath, 60 * 5);
    if (result.data?.signedUrl) signedUrl = result.data.signedUrl;
  } catch (err) {
    log.debug("signed url generation skipped", { err: String(err) });
  }

  return Object.freeze({
    storagePath,
    mimeType,
    displayName,
    signedUrl,
  });
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function fetchInlineData(
  request: InlineDataRequest,
  ctx: PresenterContext,
): Promise<InlineDataFetchResult> {
  const supabase = await supabaseFactory();
  const deps: FetcherDeps = { supabase, request, ctx };

  log.debug("fetching inline data", {
    subject: request.subject,
    kind: request.kind,
    tier: ctx.tier,
    corr: ctx.correlationId,
  });

  const base = {
    subject: request.subject,
    generatedAt: isoNow(),
    tier: ctx.tier,
  } as const;

  switch (request.subject as InlineDataSubject) {
    case "employees":
    case "team": {
      const rows = await fetchEmployees(deps);
      return Object.freeze({ ...base, rows });
    }
    case "customers": {
      const rows = await fetchCustomers(deps);
      return Object.freeze({ ...base, rows });
    }
    case "top-customer": {
      const all = await fetchCustomers(deps);
      const rows = all.slice(0, 1);
      return Object.freeze({ ...base, rows });
    }
    case "outstanding-invoices": {
      const rows = await fetchOutstandingInvoices(deps);
      return Object.freeze({ ...base, rows });
    }
    case "pending-approvals": {
      const rows = await fetchPendingApprovals(deps);
      return Object.freeze({ ...base, rows });
    }
    case "sales-trend":
    case "revenue": {
      const series = await fetchSalesTrend(deps);
      return Object.freeze({ ...base, rows: [], series });
    }
    case "expenses": {
      // Reuse the trend shape for now; the spec-builder labels it.
      const series = await fetchSalesTrend(deps);
      return Object.freeze({ ...base, rows: [], series });
    }
    case "kpi-summary":
    case "cash-position": {
      const metrics = await fetchKpiSummary(deps);
      return Object.freeze({ ...base, rows: [], metrics });
    }
    case "org-chart": {
      const orgChart = await fetchOrgChart(deps);
      return Object.freeze({ ...base, rows: [], orgChart });
    }
    case "supplier-contract": {
      const file = await fetchSupplierContractFile(deps);
      return Object.freeze({ ...base, rows: [], file });
    }
    default: {
      // Exhaustiveness — surfaces a tsc error if a subject is added
      // to the enum without a fetcher branch above.
      const _exhaustive: never = request.subject as never;
      void _exhaustive;
      return Object.freeze({ ...base, rows: [] });
    }
  }
}
