/**
 * Concrete EmployeesReader — Supabase-backed implementation that
 * fulfils the orchestrator's `MdEmployeesPort.read` contract:
 *
 *   readEmployees(orgId) → ReadonlyArray<MdEmployeeSignal>
 *
 * Pipeline:
 *   1. Pull active employees for the org from `md_employees`.
 *   2. Pull recent (last 90 days) feedback turns from
 *      `md_employee_feedback_turns` (small, denormalised log used
 *      exclusively for sentiment).
 *   3. Run `extractSentimentEvents` per turn, then
 *      `aggregateAcrossEmployees` to collapse to per-employee summaries.
 *   4. Map to MdEmployeeSignal — including `daysSinceLastOneOnOne`
 *      derived from `employees.last1on1At` (or hireDate as a floor).
 *
 * Bank-grade discipline:
 *   - Aborts the per-table query if the Supabase call rejects;
 *     never lets one missing table sink the whole reader.
 *   - All reads scope by `org_id` — RLS will enforce this server-side
 *     too, but we apply it client-side so a wrong client config
 *     surfaces explicitly.
 *   - Read budget capped at 500 employees / 2000 turns per call.
 *
 * @module features/central-command/md/composition/employees-reader-impl
 */

import { createLogger } from "@/lib/logger";

import {
  aggregateAcrossEmployees,
  extractSentimentEvents,
} from "@/features/central-command/md/employees/feedback-aggregator";
import type {
  Employee,
  FeedbackTurn,
  SentimentAggregate,
  SentimentEvent,
} from "@/features/central-command/md/employees/types";
import type { MdEmployeeSignal } from "@/features/central-command/md/core/contracts";

import type { EmployeesReaderFn } from "./employees-adapter";

const log = createLogger("md.employees.reader-impl");

const MAX_EMPLOYEES = 500;
const MAX_FEEDBACK_TURNS = 2_000;
const FEEDBACK_LOOKBACK_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export interface EmployeesReaderSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
  };
}

export interface MakeEmployeesReaderDeps {
  readonly supabase: EmployeesReaderSupabaseLike;
  /** Optional clock override for tests. */
  readonly now?: () => Date;
}

/**
 * Build the concrete reader. Returns a function the chat route plugs
 * straight into `createEmployeesAdapter({ reader })`.
 */
export function makeEmployeesReader({
  supabase,
  now,
}: MakeEmployeesReaderDeps): EmployeesReaderFn {
  const clock = now ?? (() => new Date());

  return async function readEmployeeSignals(
    orgId: string,
  ): Promise<ReadonlyArray<MdEmployeeSignal>> {
    const today = clock();
    const sinceIso = new Date(
      today.getTime() - FEEDBACK_LOOKBACK_DAYS * MS_PER_DAY,
    ).toISOString();

    const employees = await readEmployees(supabase, orgId).catch((e) => {
      log.warn("md.employees.reader.employees-read-failed", {
        orgId,
        error: e instanceof Error ? e.message : String(e),
      });
      return [] as ReadonlyArray<Employee>;
    });
    if (employees.length === 0) return [];

    const feedbackTurns = await readFeedbackTurns(
      supabase,
      orgId,
      sinceIso,
    ).catch((e) => {
      log.warn("md.employees.reader.feedback-read-failed", {
        orgId,
        error: e instanceof Error ? e.message : String(e),
      });
      return [] as ReadonlyArray<FeedbackTurn>;
    });

    const events: SentimentEvent[] = [];
    for (const turn of feedbackTurns) {
      try {
        const turnEvents = extractSentimentEvents({ turn, employees });
        for (const e of turnEvents) events.push(e);
      } catch (e) {
        log.debug("md.employees.reader.extract-failed", {
          turnId: turn.turnId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const aggregates: ReadonlyArray<SentimentAggregate> =
      events.length > 0 ? aggregateAcrossEmployees(events, today) : [];
    const aggregateById = new Map(
      aggregates.map((a) => [a.employeeId, a] as const),
    );

    return Object.freeze(
      employees.map((e): MdEmployeeSignal => {
        const agg = aggregateById.get(e.id);
        const daysSinceLastOneOnOne = computeDaysSince(
          e.last1on1At ?? e.hireDate,
          today,
        );
        const sentiment = mapPolarity(agg?.classification ?? null);
        const riskScore = computeRiskScore({
          sentiment,
          daysSinceLastOneOnOne,
          sampleSize: agg?.sampleSize ?? 0,
          weightedScore: agg?.weightedScore ?? 0,
        });
        return Object.freeze({
          employeeId: e.id,
          name: e.name,
          recentSentiment: sentiment,
          daysSinceLastOneOnOne,
          riskScore,
        });
      }),
    );
  };
}

// ---------------------------------------------------------------------------
// Supabase reads
// ---------------------------------------------------------------------------

async function readEmployees(
  supabase: EmployeesReaderSupabaseLike,
  orgId: string,
): Promise<ReadonlyArray<Employee>> {
  const r = await supabase
    .from("md_employees")
    .select(
      "id, tenant_id, name, role, hire_date, manager, last_1_on_1_at, feedback_received_at, sentiment, created_at, metadata",
    )
    .eq("tenant_id", orgId)
    .is("ended_at", null)
    .limit(MAX_EMPLOYEES);
  const data = (r as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  const out: Employee[] = [];
  for (const row of data) {
    const r2 = row as Record<string, unknown>;
    if (!r2.id || !r2.name) continue;
    out.push(
      Object.freeze({
        id: String(r2.id),
        tenantId: String(r2.tenant_id ?? orgId),
        name: String(r2.name),
        role: String(r2.role ?? "Unknown"),
        hireDate: String(r2.hire_date ?? new Date(0).toISOString()),
        manager: (r2.manager as string | null | undefined) ?? null,
        last1on1At: (r2.last_1_on_1_at as string | null | undefined) ?? null,
        feedbackReceivedAt:
          (r2.feedback_received_at as string | null | undefined) ?? null,
        sentiment: null,
        createdAt: String(r2.created_at ?? new Date(0).toISOString()),
      }) as Employee,
    );
  }
  return out;
}

async function readFeedbackTurns(
  supabase: EmployeesReaderSupabaseLike,
  orgId: string,
  sinceIso: string,
): Promise<ReadonlyArray<FeedbackTurn>> {
  const r = await supabase
    .from("md_employee_feedback_turns")
    .select("turn_id, tenant_id, text, recorded_at, name_map")
    .eq("tenant_id", orgId)
    .gte("recorded_at", sinceIso)
    .order("recorded_at", { ascending: false })
    .limit(MAX_FEEDBACK_TURNS);
  const data = (r as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  const out: FeedbackTurn[] = [];
  for (const row of data) {
    const r2 = row as Record<string, unknown>;
    if (!r2.turn_id || typeof r2.text !== "string") continue;
    out.push(
      Object.freeze({
        turnId: String(r2.turn_id),
        tenantId: String(r2.tenant_id ?? orgId),
        text: r2.text,
        recordedAt: String(r2.recorded_at ?? sinceIso),
        nameMap:
          (r2.name_map as Record<string, string> | undefined) ?? undefined,
      }) as FeedbackTurn,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDaysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 9999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

function mapPolarity(
  classification: "positive" | "neutral" | "concerning" | null,
): MdEmployeeSignal["recentSentiment"] {
  switch (classification) {
    case "positive":
      return "positive";
    case "concerning":
      return "negative";
    case "neutral":
      return "neutral";
    default:
      return "neutral";
  }
}

interface RiskInput {
  readonly sentiment: MdEmployeeSignal["recentSentiment"];
  readonly daysSinceLastOneOnOne: number;
  readonly sampleSize: number;
  readonly weightedScore: number;
}

/**
 * Compose a 0..1 risk score. Higher = more attention needed.
 *
 *   - 60% sentiment (negative pulls upward)
 *   - 30% 1-on-1 staleness (>45d climbs)
 *   - 10% sample-size confidence penalty (low N inflates baseline)
 */
function computeRiskScore({
  sentiment,
  daysSinceLastOneOnOne,
  sampleSize,
  weightedScore,
}: RiskInput): number {
  const sentimentTerm =
    sentiment === "negative"
      ? 0.6 + Math.abs(Math.min(0, weightedScore)) * 0.4
      : sentiment === "mixed"
        ? 0.4
        : sentiment === "neutral"
          ? 0.2
          : 0.0;
  const stalenessTerm = Math.min(1, daysSinceLastOneOnOne / 90);
  const confidencePenalty = sampleSize === 0 ? 0.05 : 0;
  const raw = 0.6 * sentimentTerm + 0.3 * stalenessTerm + confidencePenalty;
  return Math.min(1, Math.max(0, Number(raw.toFixed(3))));
}
