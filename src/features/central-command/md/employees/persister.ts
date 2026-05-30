/**
 * Employees — Supabase Persister
 *
 * Persists employees, sentiment events, and onboarding plans. Tenant-scoped
 * + RLS enforced.
 *
 * @module features/central-command/md/employees/persister
 */

import { createLogger } from "@/lib/logger";
import {
  employeeSchema,
  onboardingPlanSchema,
  sentimentEventSchema,
  type Employee,
  type OnboardingPlan,
  type SentimentEvent,
} from "./types";

const log = createLogger("md.employees.persister");

export interface SupabaseLike {
  from: (table: string) => SupabaseTable;
}

export interface SupabaseTable {
  upsert: (
    rows: ReadonlyArray<Record<string, unknown>>,
    opts?: { readonly onConflict?: string },
  ) => Promise<{ error: unknown }>;
  insert: (
    rows: ReadonlyArray<Record<string, unknown>>,
  ) => Promise<{ error: unknown }>;
  select: (cols: string) => SupabaseQuery;
}

export interface SupabaseQuery {
  eq: (col: string, val: unknown) => SupabaseQuery;
  gte?: (col: string, val: unknown) => SupabaseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => SupabaseQuery;
  limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
}

export interface EmployeesPersisterConfig {
  readonly employeesTable?: string;
  readonly sentimentTable?: string;
  readonly plansTable?: string;
}

const DEFAULT_EMPLOYEES = "employees";
const DEFAULT_SENTIMENT = "employee_sentiment_events";
const DEFAULT_PLANS = "onboarding_plans";

export interface EmployeesPersister {
  upsertEmployee(e: Employee): Promise<void>;
  upsertEmployees(es: ReadonlyArray<Employee>): Promise<void>;
  recordSentimentEvents(evs: ReadonlyArray<SentimentEvent>): Promise<void>;
  upsertPlan(p: OnboardingPlan): Promise<void>;
  listEmployees(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<Employee>>;
}

export function makeEmployeesPersister(
  supabase: SupabaseLike,
  config: EmployeesPersisterConfig = {},
): EmployeesPersister {
  const eTable = config.employeesTable ?? DEFAULT_EMPLOYEES;
  const sTable = config.sentimentTable ?? DEFAULT_SENTIMENT;
  const pTable = config.plansTable ?? DEFAULT_PLANS;

  return Object.freeze({
    async upsertEmployee(e: Employee): Promise<void> {
      const parsed = employeeSchema.parse(e);
      const row = employeeToRow(parsed);
      const { error } = await supabase
        .from(eTable)
        .upsert([row], { onConflict: "id" });
      if (error) {
        log.warn("upsertEmployee failed", { id: parsed.id, error });
        throw new Error(`employees upsert failed: ${stringifyError(error)}`);
      }
    },
    async upsertEmployees(es: ReadonlyArray<Employee>): Promise<void> {
      if (es.length === 0) return;
      const rows = es.map((e) => employeeToRow(employeeSchema.parse(e)));
      const { error } = await supabase
        .from(eTable)
        .upsert(rows, { onConflict: "id" });
      if (error) {
        log.warn("upsertEmployees failed", { count: es.length, error });
        throw new Error(
          `employees upsertMany failed: ${stringifyError(error)}`,
        );
      }
    },
    async recordSentimentEvents(
      evs: ReadonlyArray<SentimentEvent>,
    ): Promise<void> {
      if (evs.length === 0) return;
      const rows = evs.map((e) => eventToRow(sentimentEventSchema.parse(e)));
      const { error } = await supabase.from(sTable).insert(rows);
      if (error) {
        log.warn("recordSentimentEvents failed", { count: evs.length, error });
        throw new Error(
          `sentiment_events insert failed: ${stringifyError(error)}`,
        );
      }
    },
    async upsertPlan(p: OnboardingPlan): Promise<void> {
      const parsed = onboardingPlanSchema.parse(p);
      const row = planToRow(parsed);
      const { error } = await supabase
        .from(pTable)
        .upsert([row], { onConflict: "id" });
      if (error) {
        log.warn("upsertPlan failed", { id: parsed.id, error });
        throw new Error(
          `onboarding_plans upsert failed: ${stringifyError(error)}`,
        );
      }
    },
    async listEmployees(
      tenantId: string,
      limit = 200,
    ): Promise<ReadonlyArray<Employee>> {
      const q = supabase
        .from(eTable)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      const { data, error } = await q;
      if (error) {
        log.warn("listEmployees failed", { tenantId, error });
        throw new Error(`employees list failed: ${stringifyError(error)}`);
      }
      if (!Array.isArray(data)) return Object.freeze([]);
      const out: Employee[] = [];
      for (const raw of data) {
        const parsed = rowToEmployee(raw);
        if (parsed) out.push(parsed);
      }
      return Object.freeze(out);
    },
  });
}

function employeeToRow(e: Employee): Record<string, unknown> {
  return {
    id: e.id,
    tenant_id: e.tenantId,
    name: e.name,
    role: e.role,
    hire_date: e.hireDate,
    manager: e.manager ?? null,
    last_1on1_at: e.last1on1At ?? null,
    feedback_received_at: e.feedbackReceivedAt ?? null,
    sentiment: e.sentiment ?? null,
    created_at: e.createdAt,
    metadata: e.metadata ?? null,
  };
}

function rowToEmployee(raw: unknown): Employee | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    role: r.role,
    hireDate: r.hire_date,
    manager: r.manager,
    last1on1At: r.last_1on1_at,
    feedbackReceivedAt: r.feedback_received_at,
    sentiment: r.sentiment,
    createdAt: r.created_at,
    metadata: r.metadata,
  };
  const parsed = employeeSchema.safeParse(candidate);
  if (!parsed.success) {
    log.warn("employee row failed schema", {
      id: r.id,
      issues: parsed.error.issues.length,
    });
    return null;
  }
  return Object.freeze(parsed.data);
}

function eventToRow(e: SentimentEvent): Record<string, unknown> {
  return {
    id: e.id,
    tenant_id: e.tenantId,
    employee_id: e.employeeId,
    polarity: e.polarity,
    score: e.score,
    evidence: e.evidence,
    origin_turn_id: e.originTurnId,
    recorded_at: e.recordedAt,
  };
}

function planToRow(p: OnboardingPlan): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    employee_id: p.employeeId,
    milestones: p.milestones,
    cadence_days: p.cadenceDays,
    created_at: p.createdAt,
  };
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
