/**
 * Timeline — Owner-Style Adapter
 *
 * The MD stores one canonical DAG per project but presents it in three
 * surface styles depending on owner preference:
 *
 *   - waterfall    → linear gantt-style rows ordered by earliestStartAt
 *   - agile-cycles → fixed-length cycles (default 14 days), milestones
 *                    bucketed by their dueAt
 *   - kanban       → status columns (not_started / in_progress / blocked
 *                    / done), no time axis
 *
 * Adapter is pure data → never persists.
 *
 * @module features/central-command/md/timeline/owner-style-adapter
 */

import type {
  Milestone,
  MilestoneStatus,
  Timeline,
  TimelineStyle,
} from "./types";

export interface WaterfallRow {
  readonly id: string;
  readonly label: string;
  readonly startAt: string;
  readonly dueAt: string;
  readonly durationDays: number;
  readonly onCriticalPath: boolean;
}

export interface WaterfallView {
  readonly kind: "waterfall";
  readonly projectName: string;
  readonly rows: ReadonlyArray<WaterfallRow>;
  readonly criticalPath: ReadonlyArray<string>;
}

export interface AgileCycle {
  readonly cycleIndex: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly milestones: ReadonlyArray<Milestone>;
}

export interface AgileView {
  readonly kind: "agile-cycles";
  readonly projectName: string;
  readonly cycleLengthDays: number;
  readonly cycles: ReadonlyArray<AgileCycle>;
}

export interface KanbanColumn {
  readonly status: MilestoneStatus;
  readonly milestones: ReadonlyArray<Milestone>;
}

export interface KanbanView {
  readonly kind: "kanban";
  readonly projectName: string;
  readonly columns: ReadonlyArray<KanbanColumn>;
}

export type TimelineView = WaterfallView | AgileView | KanbanView;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface AdapterOptions {
  /** Cycle length for agile mode. Default = 14 days. */
  readonly cycleLengthDays?: number;
}

/**
 * Render a `Timeline` in the owner-preferred style.
 */
export function adaptTimeline(
  timeline: Timeline,
  style: TimelineStyle = timeline.style,
  options: AdapterOptions = {},
): TimelineView {
  switch (style) {
    case "waterfall":
      return renderWaterfall(timeline);
    case "agile-cycles":
      return renderAgile(timeline, options.cycleLengthDays ?? 14);
    case "kanban":
      return renderKanban(timeline);
    default:
      throw new Error(`unknown style: ${String(style)}`);
  }
}

function renderWaterfall(timeline: Timeline): WaterfallView {
  const rows = timeline.milestones
    .slice()
    .sort((a, b) => startMs(a) - startMs(b))
    .map((m) =>
      Object.freeze({
        id: m.id,
        label: m.label,
        startAt: m.earliestStartAt ?? timeline.startsAt,
        dueAt: m.dueAt ?? timeline.endsAt,
        durationDays: m.durationDays,
        onCriticalPath: m.onCriticalPath,
      }),
    );
  return Object.freeze({
    kind: "waterfall",
    projectName: timeline.projectName,
    rows: Object.freeze(rows),
    criticalPath: Object.freeze(
      rows.filter((r) => r.onCriticalPath).map((r) => r.id),
    ),
  });
}

function renderAgile(timeline: Timeline, cycleLengthDays: number): AgileView {
  if (cycleLengthDays <= 0) throw new Error("cycleLengthDays must be > 0");
  const start = new Date(timeline.startsAt).getTime();
  const end = new Date(timeline.endsAt).getTime();
  const totalDays = Math.max(1, Math.ceil((end - start) / MS_PER_DAY));
  const cycleCount = Math.max(1, Math.ceil(totalDays / cycleLengthDays));
  const cycles: AgileCycle[] = [];
  for (let i = 0; i < cycleCount; i += 1) {
    const cycleStart = start + i * cycleLengthDays * MS_PER_DAY;
    const cycleEnd = cycleStart + cycleLengthDays * MS_PER_DAY;
    const bucket = timeline.milestones.filter((m) => {
      const dueMs = new Date(m.dueAt ?? timeline.endsAt).getTime();
      return dueMs >= cycleStart && dueMs < cycleEnd;
    });
    cycles.push(
      Object.freeze({
        cycleIndex: i,
        startsAt: new Date(cycleStart).toISOString(),
        endsAt: new Date(cycleEnd).toISOString(),
        milestones: Object.freeze(bucket.map((m) => Object.freeze({ ...m }))),
      }),
    );
  }
  return Object.freeze({
    kind: "agile-cycles",
    projectName: timeline.projectName,
    cycleLengthDays,
    cycles: Object.freeze(cycles),
  });
}

function renderKanban(timeline: Timeline): KanbanView {
  const columns: ReadonlyArray<MilestoneStatus> = Object.freeze([
    "not_started",
    "in_progress",
    "blocked",
    "done",
    "skipped",
  ]);
  const grouped = columns.map((status) =>
    Object.freeze({
      status,
      milestones: Object.freeze(
        timeline.milestones
          .filter((m) => m.status === status)
          .map((m) => Object.freeze({ ...m })),
      ),
    }),
  );
  return Object.freeze({
    kind: "kanban",
    projectName: timeline.projectName,
    columns: Object.freeze(grouped),
  });
}

function startMs(m: Milestone): number {
  return new Date(m.earliestStartAt ?? 0).getTime();
}
