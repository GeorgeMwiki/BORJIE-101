/**
 * Timeline — Critical Path Method (CPM)
 *
 * Pure algorithmic core. Given a milestone DAG with per-node durations,
 * computes:
 *   - earliest start / earliest finish per milestone
 *   - latest start / latest finish per milestone
 *   - total project duration
 *   - the critical path (nodes whose slack === 0)
 *
 * Throws on cycles or unknown dependency IDs — the caller must catch.
 *
 * @module features/central-command/md/timeline/cpm
 */

import type { CpmResult, Milestone } from "./types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface CpmInput {
  readonly milestones: ReadonlyArray<
    Pick<Milestone, "id" | "label" | "durationDays" | "dependencies">
  >;
  readonly startsAt: string;
}

/**
 * Run CPM scheduling. Pure, deterministic.
 */
export function runCpm(input: CpmInput): CpmResult {
  if (input.milestones.length === 0) {
    throw new Error("cpm: at least one milestone required");
  }
  const startMs = new Date(input.startsAt).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(`cpm: invalid startsAt '${input.startsAt}'`);
  }
  const idSet = new Set(input.milestones.map((m) => m.id));
  for (const m of input.milestones) {
    for (const d of m.dependencies) {
      if (!idSet.has(d)) {
        throw new Error(`cpm: unknown dependency '${d}' on '${m.id}'`);
      }
    }
  }

  const order = topoSort(input.milestones);

  // Forward pass — earliest start / earliest finish (in days)
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const m = mustFind(input.milestones, id);
    const earliest =
      m.dependencies.length === 0
        ? 0
        : Math.max(...m.dependencies.map((d) => ef.get(d) ?? 0));
    es.set(id, earliest);
    ef.set(id, earliest + m.durationDays);
  }
  const projectDuration = Math.max(...ef.values());

  // Backward pass — latest finish / latest start
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const m = mustFind(input.milestones, id);
    const successors = input.milestones.filter((x) =>
      x.dependencies.includes(id),
    );
    const latestFinish =
      successors.length === 0
        ? projectDuration
        : Math.min(...successors.map((s) => ls.get(s.id) ?? projectDuration));
    lf.set(id, latestFinish);
    ls.set(id, latestFinish - m.durationDays);
  }

  // Critical path = nodes where slack (ls - es) === 0
  const critical = new Set<string>();
  for (const id of order) {
    const slack = (ls.get(id) ?? 0) - (es.get(id) ?? 0);
    if (slack === 0) critical.add(id);
  }

  const milestones: ReadonlyArray<Milestone> = input.milestones.map((m) => {
    const start = es.get(m.id) ?? 0;
    const finish = ef.get(m.id) ?? start;
    return Object.freeze({
      id: m.id,
      label: m.label,
      durationDays: m.durationDays,
      dependencies: [...m.dependencies],
      earliestStartAt: addDays(startMs, start),
      dueAt: addDays(startMs, finish),
      status: "not_started",
      onCriticalPath: critical.has(m.id),
    });
  });

  return Object.freeze({
    milestones: Object.freeze(milestones),
    criticalPath: Object.freeze(orderedCriticalPath(milestones, critical)),
    totalDurationDays: projectDuration,
    endsAt: addDays(startMs, projectDuration),
  });
}

function mustFind<T extends { id: string }>(
  arr: ReadonlyArray<T>,
  id: string,
): T {
  const found = arr.find((x) => x.id === id);
  if (!found) throw new Error(`cpm: milestone '${id}' missing`);
  return found;
}

function addDays(startMs: number, days: number): string {
  return new Date(startMs + days * MS_PER_DAY).toISOString();
}

/**
 * Kahn's algorithm — produces a stable topological order; throws on
 * cycles. Stability comes from sorting candidates by id at each step.
 */
function topoSort(
  ms: ReadonlyArray<Pick<Milestone, "id" | "dependencies">>,
): ReadonlyArray<string> {
  const indeg = new Map<string, number>();
  const adj = new Map<string, Array<string>>();
  for (const m of ms) {
    indeg.set(m.id, m.dependencies.length);
    adj.set(m.id, []);
  }
  for (const m of ms) {
    for (const d of m.dependencies) {
      adj.get(d)!.push(m.id);
    }
  }
  const ready: string[] = [...indeg.entries()]
    .filter(([, n]) => n === 0)
    .map(([id]) => id)
    .sort();
  const out: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    out.push(next);
    for (const child of adj.get(next) ?? []) {
      const newDeg = (indeg.get(child) ?? 0) - 1;
      indeg.set(child, newDeg);
      if (newDeg === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }
  if (out.length !== ms.length) {
    throw new Error("cpm: cycle detected in dependencies");
  }
  return out;
}

function orderedCriticalPath(
  ms: ReadonlyArray<Milestone>,
  critical: Set<string>,
): ReadonlyArray<string> {
  // Order critical-path nodes by earliestStart
  return ms
    .filter((m) => critical.has(m.id))
    .slice()
    .sort((a, b) => {
      const aT = new Date(a.earliestStartAt ?? 0).getTime();
      const bT = new Date(b.earliestStartAt ?? 0).getTime();
      return aT - bT;
    })
    .map((m) => m.id);
}
