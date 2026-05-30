/**
 * InternalLookupProvider — Supabase full-text lookup across MD-relevant
 * tables, scoped to the caller's org and RLS-respecting.
 *
 * Pairs with `WebSearchProvider` + `WebFetchProvider` to give
 * `runDeepResearch` an "obsessed-with-the-business" internal lane.
 * When the owner asks "what did Acme Ltd say in their last NPS
 * survey", the synthesis pulls the actual customer row + the latest
 * complaint thread BEFORE the web search even fires.
 *
 * Search surface (v1, can be extended without changing the port):
 *
 *   - `ap_customers`           ← display_name, notes, industry, contact_name
 *                                (canonical extracted-customer table from
 *                                 20260621_md_auto_populate.sql; previously
 *                                 referenced a non-existent `customers` table)
 *   - `leads`                  ← contact_name, notes, last_activity
 *   - `employees`              ← name, role, latest_1on1_notes
 *   - `compliance_obligations` ← description, regulator_notes
 *   - `brain_thoughts`         ← content (so prior MD observations
 *                                surface back into new turns)
 *
 * Bank-grade discipline:
 *   - Every read carries `org_id = ctx.orgId`. RLS enforces the same
 *     guarantee at the DB layer; this is defence-in-depth.
 *   - All matches return `relevance` in [0, 1]; the value is
 *     deterministic (lexical match-count + recency boost) so the MD's
 *     `runDeepResearch` confidence formula stays reproducible.
 *   - Per-table timeout (default 3 s); a slow table contributes []
 *     rather than blocking the synthesis.
 *
 * @module features/central-command/md/research/internal-lookup-provider
 */

import { createLogger } from "@/lib/logger";

import type { InternalLookupProvider, ResearchFinding } from "./deep-research";

const log = createLogger("md.research.internal-lookup");

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_PER_TABLE_LIMIT = 5;
const STOPWORDS = new Set([
  "the",
  "and",
  "a",
  "an",
  "of",
  "to",
  "in",
  "for",
  "is",
  "on",
  "at",
  "as",
  "by",
  "with",
  "from",
  "this",
  "that",
]);

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

export interface InternalLookupSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
  };
}

export interface MakeInternalLookupProviderOptions {
  /** Override the per-table timeout (default 3 s). */
  readonly timeoutMs?: number;
  /** Override the per-table row limit (default 5). */
  readonly perTableLimit?: number;
  /** Inject a clock for the recency boost. */
  readonly clock?: () => number;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeInternalLookupProvider(
  supabase: InternalLookupSupabaseLike,
  orgId: string,
  options: MakeInternalLookupProviderOptions = {},
): InternalLookupProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const perTableLimit = options.perTableLimit ?? DEFAULT_PER_TABLE_LIMIT;
  const clock = options.clock ?? Date.now;

  return async (rawQuery: string): Promise<ReadonlyArray<ResearchFinding>> => {
    const tokens = tokenize(rawQuery);
    if (tokens.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    const timer = (): Promise<{ data: any[] | null }> =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: null }), timeoutMs),
      );

    const wrap = async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
      q: any,
      tableName: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    ): Promise<{ data: any[] | null }> => {
      try {
        const winner = await Promise.race([q, timer()]);
        return winner as { data: unknown[] | null };
      } catch (e) {
        log.warn("internal-lookup.query-failed", {
          orgId,
          table: tableName,
          error: e instanceof Error ? e.message : String(e),
        });
        return { data: null };
      }
    };

    const ilikeFilter = (cols: string): string =>
      tokens.map((t) => `${cols}.ilike.%${escapeIlike(t)}%`).join(",");

    // Parallel fan-out across the five tables. Each query uses Supabase's
    // `or` with `ilike` patterns. Postgres still scans, but the result
    // set is capped by `.limit()` per table.
    const [customerRows, leadRows, employeeRows, complianceRows, thoughtRows] =
      await Promise.all([
        wrap(
          supabase
            .from("ap_customers")
            .select(
              "id, display_name, notes, industry, contact_name, updated_at",
            )
            .eq("tenant_id", orgId)
            .or(ilikeFilter("display_name") + "," + ilikeFilter("notes"))
            .limit(perTableLimit),
          "ap_customers",
        ),
        wrap(
          supabase
            .from("leads")
            .select("id, contact_name, notes, stage, updated_at")
            .eq("org_id", orgId)
            .or(ilikeFilter("contact_name") + "," + ilikeFilter("notes"))
            .limit(perTableLimit),
          "leads",
        ),
        wrap(
          supabase
            .from("employees")
            .select("id, name, role, latest_1on1_notes, updated_at")
            .eq("org_id", orgId)
            .or(ilikeFilter("name") + "," + ilikeFilter("latest_1on1_notes"))
            .limit(perTableLimit),
          "employees",
        ),
        wrap(
          supabase
            .from("compliance_obligations")
            .select("id, description, regulator_notes, due_at, status")
            .eq("org_id", orgId)
            .or(
              ilikeFilter("description") + "," + ilikeFilter("regulator_notes"),
            )
            .limit(perTableLimit),
          "compliance_obligations",
        ),
        wrap(
          supabase
            .from("brain_thoughts")
            .select("id, content, created_at, kind, source")
            .eq("subject_id", orgId)
            .or(ilikeFilter("content"))
            .limit(perTableLimit),
          "brain_thoughts",
        ),
      ]);

    const findings: ResearchFinding[] = [];
    const now = clock();

    for (const row of customerRows.data ?? []) {
      const text = mergeText(
        row.display_name as string,
        row.industry as string,
        row.contact_name as string,
        row.notes as string,
      );
      const relevance = scoreRelevance(text, tokens, row.updated_at, now);
      findings.push({
        source: "internal",
        rowRef: { table: "ap_customers", id: String(row.id ?? "") },
        title: `Customer: ${row.display_name ?? "(unnamed)"}`,
        excerpt: text.slice(0, 1200),
        relevance,
      });
    }
    for (const row of leadRows.data ?? []) {
      const text = mergeText(row.contact_name as string, row.notes as string);
      findings.push({
        source: "internal",
        rowRef: { table: "leads", id: String(row.id ?? "") },
        title: `Lead: ${row.contact_name ?? "(unnamed)"} (${row.stage ?? "?"})`,
        excerpt: text.slice(0, 1200),
        relevance: scoreRelevance(text, tokens, row.updated_at, now),
      });
    }
    for (const row of employeeRows.data ?? []) {
      const text = mergeText(
        row.name as string,
        row.role as string,
        row.latest_1on1_notes as string,
      );
      findings.push({
        source: "internal",
        rowRef: { table: "employees", id: String(row.id ?? "") },
        title: `Employee: ${row.name ?? "(unnamed)"}`,
        excerpt: text.slice(0, 1200),
        relevance: scoreRelevance(text, tokens, row.updated_at, now),
      });
    }
    for (const row of complianceRows.data ?? []) {
      const text = mergeText(
        row.description as string,
        row.regulator_notes as string,
      );
      findings.push({
        source: "internal",
        rowRef: { table: "compliance_obligations", id: String(row.id ?? "") },
        title: `Compliance: ${row.description?.slice?.(0, 60) ?? "(unspecified)"}`,
        excerpt: text.slice(0, 1200),
        relevance: scoreRelevance(text, tokens, row.due_at, now),
      });
    }
    for (const row of thoughtRows.data ?? []) {
      const text = String(row.content ?? "");
      findings.push({
        source: "internal",
        rowRef: { table: "brain_thoughts", id: String(row.id ?? "") },
        title: `Brain note: ${row.kind ?? "thought"}`,
        excerpt: text.slice(0, 1200),
        relevance: scoreRelevance(text, tokens, row.created_at, now),
      });
    }

    // Sort by relevance descending. The MD's `runDeepResearch` already
    // caps total findings, but pre-sorting here gives it the best ones
    // first so the synthesis summary leads with the strongest evidence.
    return findings.sort((a, b) => b.relevance - a.relevance);
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tokenize(query: string): ReadonlyArray<string> {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .slice(0, 8);
}

function escapeIlike(input: string): string {
  // Escape `%` and `_` since they are ILIKE wildcards. Use a doubled
  // backslash so the upstream Postgres parser sees a literal escape.
  return input.replace(/[%_]/g, "\\$&");
}

function mergeText(...parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === "string").join(" — ");
}

function scoreRelevance(
  text: string,
  tokens: ReadonlyArray<string>,
  recencyIso: unknown,
  nowMs: number,
): number {
  if (!text || tokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let matches = 0;
  for (const t of tokens) {
    if (lower.includes(t)) matches += 1;
  }
  const lexical = matches / tokens.length; // 0..1
  let recencyBoost = 0;
  if (typeof recencyIso === "string") {
    const t = Date.parse(recencyIso);
    if (Number.isFinite(t)) {
      const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
      // 30-day half-life recency boost capped at +0.2.
      recencyBoost = 0.2 / Math.pow(2, ageDays / 30);
    }
  }
  return Math.min(1, lexical * 0.8 + recencyBoost);
}
