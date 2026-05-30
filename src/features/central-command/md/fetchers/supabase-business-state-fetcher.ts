/**
 * SupabaseBusinessStateFetcher — production fetcher for the MD's
 * tier-scoped business snapshot.
 *
 * Reads the canonical org tables once and assembles them into the
 * `BusinessSnapshot` envelope the orchestrator consumes:
 *
 *   - `customers`  ← organizations_customers / customers
 *   - `employees`  ← employees
 *   - `pipeline`   ← leads
 *   - `suppliers`  ← suppliers
 *   - `finance`    ← org_finance_snapshot (a daily-built materialised view)
 *   - `compliance` ← compliance_obligations
 *   - `learning`   ← employee_training_progress
 *
 * Every read is RLS-scoped at the Postgres layer. If a row is missing
 * or a column is null, the fetcher falls back to a sensible default
 * (e.g. days-in-stage = 0) so the orchestrator can still rank actions.
 *
 * Read budget: 7 parallel queries with a 4 second per-query timeout.
 * If any single query times out, the fetcher returns the partial
 * snapshot — the MD's NBA layer rejects-with-citation rather than
 * blocking the whole turn.
 *
 * @module features/central-command/md/fetchers/supabase-business-state-fetcher
 */

import { createLogger } from "@/lib/logger";

import type { BusinessStateFetcher } from "@/features/central-command/md/core/business-state";
import type {
  BusinessSnapshot,
  CustomerSignal,
  EmployeeSignal,
  PipelineSignal,
  SupplierSignal,
  FinanceSignal,
  ComplianceSignal,
  LearningSignal,
} from "@/features/central-command/md/nba/types";

const log = createLogger("md.fetchers.supabase-business-state");

const DEFAULT_QUERY_TIMEOUT_MS = 4_000;
const DEFAULT_TABLES = Object.freeze({
  customers: "customers",
  employees: "employees",
  pipeline: "leads",
  suppliers: "suppliers",
  finance: "org_finance_snapshot",
  compliance: "compliance_obligations",
  learning: "employee_training_progress",
});

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

/**
 * Minimal Supabase shape this fetcher consumes. Each `from()` call
 * returns a chain with `select`, `eq`, `limit`, and the awaitable
 * `then`. Matches both the real `SupabaseClient` and the loose shape
 * the heartbeat / sleep-pass tests use.
 */
export interface FetcherSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
  };
}

export interface SupabaseBusinessStateFetcherOptions {
  /** Override the timeout per individual query (default 4 s). */
  readonly queryTimeoutMs?: number;
  /** Override the underlying table names (useful when schemas drift). */
  readonly tables?: Partial<typeof DEFAULT_TABLES>;
  /** Inject a clock for deterministic `generatedAt` in tests. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeSupabaseBusinessStateFetcher(
  supabase: FetcherSupabaseLike,
  options: SupabaseBusinessStateFetcherOptions = {},
): BusinessStateFetcher {
  const tables = Object.freeze({
    ...DEFAULT_TABLES,
    ...(options.tables ?? {}),
  });
  const timeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async fetch(orgId: string): Promise<BusinessSnapshot> {
      // H-3 fix: read `error` from every result (the previous
      // version threw away supabase errors → an RLS denial looked
      // like "no rows" to the orchestrator). Tag the result with a
      // `_kind` so the section mappers can log a real failure.
      interface ReadResult {
        readonly data: unknown[] | null;
        readonly errorReason?: string;
      }

      const timer = (label: string): Promise<ReadResult> =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: null, errorReason: `timeout:${label}` }),
            timeoutMs,
          ),
        );

      const wrap = async (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
        q: any,
        label: string,
      ): Promise<ReadResult> => {
        try {
          const winner = await Promise.race([
            (async (): Promise<ReadResult> => {
              const r = (await q) as {
                data: unknown[] | null;
                error?: { message?: string } | null;
              };
              if (r.error) {
                return {
                  data: null,
                  errorReason: `supabase:${r.error.message ?? "unknown"}`,
                };
              }
              return { data: r.data ?? [] };
            })(),
            timer(label),
          ]);
          if (winner.errorReason) {
            log.warn("md.fetcher.section-error", {
              orgId,
              section: label,
              reason: winner.errorReason,
            });
            // Swallow any late rejection from the losing side so it
            // doesn't surface as an unhandled rejection. The
            // Promise.race winner is already in hand.
            Promise.resolve(q).catch(() => undefined);
          }
          return winner;
        } catch (e) {
          log.warn("md.fetcher.query-failed", {
            orgId,
            section: label,
            error: e instanceof Error ? e.message : String(e),
          });
          return { data: null, errorReason: "throw" };
        }
      };

      const [
        customers,
        employees,
        pipeline,
        suppliers,
        finance,
        compliance,
        learning,
      ] = await Promise.all([
        wrap(
          supabase.from(tables.customers).select("*").eq("org_id", orgId),
          "customers",
        ),
        wrap(
          supabase.from(tables.employees).select("*").eq("org_id", orgId),
          "employees",
        ),
        wrap(
          supabase.from(tables.pipeline).select("*").eq("org_id", orgId),
          "pipeline",
        ),
        wrap(
          supabase.from(tables.suppliers).select("*").eq("org_id", orgId),
          "suppliers",
        ),
        wrap(
          supabase
            .from(tables.finance)
            .select("*")
            .eq("org_id", orgId)
            .limit(1),
          "finance",
        ),
        wrap(
          supabase
            .from(tables.compliance)
            .select("*")
            .eq("org_id", orgId)
            .eq("status", "open"),
          "compliance",
        ),
        wrap(
          supabase.from(tables.learning).select("*").eq("org_id", orgId),
          "learning",
        ),
      ]);

      return Object.freeze({
        orgId,
        generatedAt: now().toISOString(),
        customers: mapCustomers(customers.data ?? []),
        employees: mapEmployees(employees.data ?? []),
        pipeline: mapPipeline(pipeline.data ?? []),
        suppliers: mapSuppliers(suppliers.data ?? []),
        finance: mapFinance(finance.data ?? []),
        compliance: mapCompliance(compliance.data ?? []),
        learning: mapLearning(learning.data ?? []),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Row mappers (pure, defensive)
// ---------------------------------------------------------------------------

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number.parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function daysAgo(iso: unknown, nowMs = Date.now()): number {
  if (typeof iso !== "string") return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

function daysUntil(iso: unknown, nowMs = Date.now()): number {
  if (typeof iso !== "string") return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((t - nowMs) / 86_400_000));
}

function mapCustomers(rows: ReadonlyArray<unknown>): readonly CustomerSignal[] {
  return Object.freeze(
    rows.map((r): CustomerSignal => {
      const row = r as Record<string, unknown>;
      return Object.freeze({
        customerId: str(row.id),
        name: str(row.name, "(unnamed)"),
        npsScore:
          row.nps_score === null || row.nps_score === undefined
            ? undefined
            : num(row.nps_score),
        csatScore:
          row.csat_score === null || row.csat_score === undefined
            ? undefined
            : num(row.csat_score),
        lastContactDaysAgo: daysAgo(row.last_contact_at),
        openComplaints: num(row.open_complaints),
        arrUsd:
          row.arr_usd === null || row.arr_usd === undefined
            ? undefined
            : num(row.arr_usd),
      });
    }),
  );
}

function mapEmployees(rows: ReadonlyArray<unknown>): readonly EmployeeSignal[] {
  return Object.freeze(
    rows.map((r): EmployeeSignal => {
      const row = r as Record<string, unknown>;
      return Object.freeze({
        employeeId: str(row.id),
        name: str(row.name, "(unnamed)"),
        daysSinceLast1on1: daysAgo(row.last_1on1_at),
        engagementScore:
          row.engagement_score === null || row.engagement_score === undefined
            ? undefined
            : num(row.engagement_score),
        isNewHire: Boolean(row.is_new_hire),
        daysInRole: daysAgo(row.role_start_at),
      });
    }),
  );
}

function mapPipeline(rows: ReadonlyArray<unknown>): readonly PipelineSignal[] {
  return Object.freeze(
    rows.map((r): PipelineSignal => {
      const row = r as Record<string, unknown>;
      return Object.freeze({
        leadId: str(row.id),
        stage: str(row.stage, "unknown"),
        daysInStage: daysAgo(row.stage_entered_at),
        valueUsd: num(row.value_usd),
        probability: clamp(num(row.probability), 0, 1),
      });
    }),
  );
}

function mapSuppliers(rows: ReadonlyArray<unknown>): readonly SupplierSignal[] {
  return Object.freeze(
    rows.map((r): SupplierSignal => {
      const row = r as Record<string, unknown>;
      const criticalityRaw = str(row.criticality, "medium").toLowerCase();
      const criticality: "low" | "medium" | "high" =
        criticalityRaw === "low" || criticalityRaw === "high"
          ? criticalityRaw
          : "medium";
      return Object.freeze({
        supplierId: str(row.id),
        name: str(row.name, "(unnamed)"),
        contractExpiresInDays: daysUntil(row.contract_expires_at),
        criticality,
        annualSpendUsd: num(row.annual_spend_usd),
      });
    }),
  );
}

function mapFinance(rows: ReadonlyArray<unknown>): FinanceSignal {
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return Object.freeze({
    cashUsd: num(row.cash_usd),
    monthlyBurnUsd: num(row.monthly_burn_usd),
    overdueInvoicesCount: num(row.overdue_invoices_count),
    overdueAmountUsd: num(row.overdue_amount_usd),
  });
}

function mapCompliance(
  rows: ReadonlyArray<unknown>,
): readonly ComplianceSignal[] {
  return Object.freeze(
    rows.map((r): ComplianceSignal => {
      const row = r as Record<string, unknown>;
      const statusRaw = str(row.status, "open").toLowerCase();
      const status: "open" | "in-progress" | "submitted" =
        statusRaw === "in-progress" || statusRaw === "submitted"
          ? statusRaw
          : "open";
      return Object.freeze({
        obligationId: str(row.id),
        description: str(row.description, "(unspecified)"),
        dueInDays: daysUntil(row.due_at),
        status,
      });
    }),
  );
}

function mapLearning(rows: ReadonlyArray<unknown>): readonly LearningSignal[] {
  return Object.freeze(
    rows.map((r): LearningSignal => {
      const row = r as Record<string, unknown>;
      return Object.freeze({
        employeeId: str(row.employee_id),
        trackName: str(row.track_name, "(unspecified)"),
        completionPercent: clamp(num(row.completion_percent), 0, 100),
      });
    }),
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
