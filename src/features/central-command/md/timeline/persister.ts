/**
 * Timeline — Supabase Persister
 *
 * Persists `Timeline` + `Milestone` rows. Tenant-scoped, RLS-enforced.
 * Each upsert is idempotent on `id`.
 *
 * @module features/central-command/md/timeline/persister
 */

import { createLogger } from "@/lib/logger";
import {
  milestoneSchema,
  timelineSchema,
  type Milestone,
  type Timeline,
} from "./types";

const log = createLogger("md.timeline.persister");

export interface SupabaseLike {
  from: (table: string) => SupabaseTable;
}

export interface SupabaseTable {
  upsert: (
    rows: ReadonlyArray<Record<string, unknown>>,
    opts?: { readonly onConflict?: string },
  ) => Promise<{ error: unknown }>;
  select: (cols: string) => SupabaseQuery;
  delete: () => SupabaseDeleteChain;
}

export interface SupabaseQuery {
  eq: (col: string, val: unknown) => SupabaseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => SupabaseQuery;
  limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
}

export interface SupabaseDeleteChain {
  eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
}

export interface TimelinePersisterConfig {
  readonly timelinesTable?: string;
  readonly milestonesTable?: string;
}

const DEFAULT_TIMELINES = "timelines";
const DEFAULT_MILESTONES = "timeline_milestones";

export interface TimelinePersister {
  upsert(t: Timeline): Promise<void>;
  list(tenantId: string, limit?: number): Promise<ReadonlyArray<Timeline>>;
  setMilestoneStatus(
    timelineId: string,
    milestoneId: string,
    status: Milestone["status"],
  ): Promise<void>;
}

export function makeTimelinePersister(
  supabase: SupabaseLike,
  config: TimelinePersisterConfig = {},
): TimelinePersister {
  const tlTable = config.timelinesTable ?? DEFAULT_TIMELINES;
  const msTable = config.milestonesTable ?? DEFAULT_MILESTONES;

  return Object.freeze({
    async upsert(t: Timeline): Promise<void> {
      const parsed = timelineSchema.parse(t);
      const tlRow = timelineToRow(parsed);
      const { error: tlErr } = await supabase
        .from(tlTable)
        .upsert([tlRow], { onConflict: "id" });
      if (tlErr) {
        log.warn("timeline upsert failed", { id: parsed.id, error: tlErr });
        throw new Error(`timelines upsert failed: ${stringifyError(tlErr)}`);
      }
      const msRows = parsed.milestones.map((m) =>
        milestoneToRow(parsed.id, parsed.tenantId, m),
      );
      const { error: msErr } = await supabase
        .from(msTable)
        .upsert(msRows, { onConflict: "id" });
      if (msErr) {
        log.warn("milestones upsert failed", {
          id: parsed.id,
          count: msRows.length,
          error: msErr,
        });
        throw new Error(`milestones upsert failed: ${stringifyError(msErr)}`);
      }
    },
    async list(
      tenantId: string,
      limit = 100,
    ): Promise<ReadonlyArray<Timeline>> {
      const q = supabase
        .from(tlTable)
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      const { data, error } = await q;
      if (error) {
        log.warn("list failed", { tenantId, error });
        throw new Error(`timelines list failed: ${stringifyError(error)}`);
      }
      if (!Array.isArray(data)) return Object.freeze([]);
      const out: Timeline[] = [];
      for (const raw of data) {
        const parsed = rowToTimeline(raw);
        if (parsed) out.push(parsed);
      }
      return Object.freeze(out);
    },
    async setMilestoneStatus(
      timelineId: string,
      milestoneId: string,
      status: Milestone["status"],
    ): Promise<void> {
      // Upsert via select-update would require a fetch; for simplicity we
      // re-upsert the milestone row with just the status patch. The
      // database has ON CONFLICT (id) DO UPDATE which merges columns.
      const row = {
        id: milestoneId,
        timeline_id: timelineId,
        status,
      };
      const { error } = await supabase
        .from(msTable)
        .upsert([row], { onConflict: "id" });
      if (error) {
        throw new Error(`milestone setStatus failed: ${stringifyError(error)}`);
      }
    },
  });
}

function timelineToRow(t: Timeline): Record<string, unknown> {
  return {
    id: t.id,
    tenant_id: t.tenantId,
    owner_id: t.ownerId,
    project_name: t.projectName,
    style: t.style,
    starts_at: t.startsAt,
    ends_at: t.endsAt,
    created_at: t.createdAt,
    dependencies: t.dependencies,
    metadata: t.metadata ?? null,
  };
}

function milestoneToRow(
  timelineId: string,
  tenantId: string,
  m: Milestone,
): Record<string, unknown> {
  return {
    id: m.id,
    timeline_id: timelineId,
    tenant_id: tenantId,
    label: m.label,
    duration_days: m.durationDays,
    due_at: m.dueAt ?? null,
    earliest_start_at: m.earliestStartAt ?? null,
    status: m.status,
    dependencies: m.dependencies,
    on_critical_path: m.onCriticalPath,
  };
}

function rowToTimeline(raw: unknown): Timeline | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = {
    id: r.id,
    tenantId: r.tenant_id,
    ownerId: r.owner_id,
    projectName: r.project_name,
    milestones: Array.isArray(r.milestones)
      ? r.milestones
          .map(rowToMilestone)
          .filter((m): m is Milestone => m !== null)
      : [],
    dependencies: Array.isArray(r.dependencies) ? r.dependencies : [],
    style: r.style,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
    metadata: r.metadata,
  };
  const parsed = timelineSchema.safeParse(candidate);
  if (!parsed.success) {
    log.warn("row failed schema validation", {
      id: r.id,
      issues: parsed.error.issues.length,
    });
    return null;
  }
  return Object.freeze(parsed.data);
}

function rowToMilestone(raw: unknown): Milestone | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = {
    id: r.id,
    label: r.label,
    durationDays: r.duration_days,
    dueAt: r.due_at,
    earliestStartAt: r.earliest_start_at,
    status: r.status ?? "not_started",
    dependencies: Array.isArray(r.dependencies) ? r.dependencies : [],
    onCriticalPath: Boolean(r.on_critical_path),
  };
  const parsed = milestoneSchema.safeParse(candidate);
  return parsed.success ? Object.freeze(parsed.data) : null;
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
