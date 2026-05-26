'use client';

/**
 * GanttChart — richer renderer for project gantts (Borjie issue #37).
 *
 * The existing catalog `gantt` artifact still projects to the `workflow`
 * AgUiUiPart for kernel emit paths. This standalone primitive is for
 * hosts that want multi-row gantts, status colours, hover tooltips, and
 * an onSelect(stepId) callback. SVG + Tailwind only, no external deps.
 */
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { Frame, GenUiError } from './Frame';

const GanttBarStatusSchema = z.enum(['queued', 'running', 'success', 'failed']);
export type GanttBarStatus = z.infer<typeof GanttBarStatusSchema>;

const Iso = z.string().min(1).refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO date');

export const GanttBarSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    startedAt: Iso,
    endedAt: Iso,
    status: GanttBarStatusSchema,
    rowKey: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((b) => Date.parse(b.endedAt) >= Date.parse(b.startedAt), {
    message: 'endedAt must be on or after startedAt',
    path: ['endedAt'],
  });

export type GanttBar = z.infer<typeof GanttBarSchema>;

export const GanttChartSchema = z
  .object({
    title: z.string().max(200).optional(),
    /** Row grouping label (junior / tenant / none). Used for display only. */
    groupBy: z.enum(['junior', 'tenant', 'none']).default('none'),
    ungroupedLabel: z.string().max(120).optional(),
    bars: z.array(GanttBarSchema).min(1).max(500),
  })
  .strict();

export type GanttChartProps = z.infer<typeof GanttChartSchema> & {
  /** Fired when the user clicks a bar. Receives the bar id. */
  readonly onSelect?: (stepId: string) => void;
};

const STATUS_FILL: Record<GanttBarStatus, string> = {
  running: 'fill-blue-500',
  success: 'fill-green-500',
  failed: 'fill-red-500',
  queued: 'fill-zinc-400',
};

const STATUS_TEXT: Record<GanttBarStatus, string> = {
  running: 'text-blue-700',
  success: 'text-green-700',
  failed: 'text-red-700',
  queued: 'text-zinc-600',
};

const STATUS_LABEL: Record<GanttBarStatus, string> = {
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  queued: 'Queued',
};

const ROW_HEIGHT = 22;
const ROW_GAP = 6;
const ROW_LABEL_WIDTH = 120;
const CANVAS_PAD_X = 8;
const CANVAS_PAD_Y = 8;
const MIN_BAR_WIDTH = 6;
const CANVAS_WIDTH = 480;

interface GroupedRow {
  readonly key: string;
  readonly label: string;
  readonly bars: ReadonlyArray<GanttBar>;
}

function groupRows(props: GanttChartProps): ReadonlyArray<GroupedRow> {
  if (props.groupBy === 'none') {
    return [{ key: '__all__', label: props.ungroupedLabel ?? 'All', bars: props.bars }];
  }
  const buckets = new Map<string, GanttBar[]>();
  for (const bar of props.bars) {
    const key = bar.rowKey && bar.rowKey.length > 0 ? bar.rowKey : '__unassigned__';
    const existing = buckets.get(key);
    if (existing) existing.push(bar);
    else buckets.set(key, [bar]);
  }
  return Array.from(buckets.entries()).map(([key, bars]) => ({
    key,
    label: key === '__unassigned__' ? props.ungroupedLabel ?? 'Unassigned' : key,
    bars,
  }));
}

function computeRange(bars: ReadonlyArray<GanttBar>): { start: number; end: number } {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    const s = Date.parse(bar.startedAt);
    const e = Date.parse(bar.endedAt);
    if (s < start) start = s;
    if (e > end) end = e;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    return { start, end: start + 1 };
  }
  return { start, end };
}

function tooltipText(bar: GanttBar): string {
  return `${bar.label}\n${STATUS_LABEL[bar.status]}\n${bar.startedAt} → ${bar.endedAt}`;
}

interface BarLayout {
  readonly x: number;
  readonly width: number;
  readonly y: number;
}

function layoutFor(
  bar: GanttBar,
  range: { start: number; end: number },
  rowIndex: number,
): BarLayout {
  const span = Math.max(1, range.end - range.start);
  const xFrac = (Date.parse(bar.startedAt) - range.start) / span;
  const wFrac = (Date.parse(bar.endedAt) - Date.parse(bar.startedAt)) / span;
  return {
    x: ROW_LABEL_WIDTH + xFrac * CANVAS_WIDTH,
    width: Math.max(MIN_BAR_WIDTH, wFrac * CANVAS_WIDTH),
    y: CANVAS_PAD_Y + rowIndex * (ROW_HEIGHT + ROW_GAP),
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function GanttChart(rawProps: GanttChartProps): JSX.Element {
  const parsed = GanttChartSchema.safeParse({
    ...rawProps,
    groupBy: rawProps.groupBy ?? 'none',
  });
  if (!parsed.success) {
    return (
      <GenUiError
        kind="gantt"
        message={parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}
      />
    );
  }
  const props: GanttChartProps = { ...parsed.data, onSelect: rawProps.onSelect };
  const [hoverId, setHoverId] = useState<string | null>(null);
  const rows = useMemo(() => groupRows(props), [props.bars, props.groupBy, props.ungroupedLabel]);
  const range = useMemo(() => computeRange(props.bars), [props.bars]);

  const svgHeight = CANVAS_PAD_Y * 2 + rows.length * (ROW_HEIGHT + ROW_GAP);
  const viewBoxWidth = ROW_LABEL_WIDTH + CANVAS_WIDTH + CANVAS_PAD_X * 2;
  const hoverBar = hoverId ? props.bars.find((b) => b.id === hoverId) : undefined;

  return (
    <Frame kind="gantt" {...(props.title ? { title: props.title } : {})}>
      <div className="relative overflow-x-auto">
        <svg
          role="img"
          aria-label={props.title ?? 'Gantt chart'}
          viewBox={`0 0 ${viewBoxWidth} ${svgHeight}`}
          width="100%"
          className="text-xs"
        >
          {rows.map((row, rowIndex) => {
            const y = CANVAS_PAD_Y + rowIndex * (ROW_HEIGHT + ROW_GAP);
            return (
              <g key={row.key}>
                <text
                  x={CANVAS_PAD_X}
                  y={y + ROW_HEIGHT * 0.7}
                  className="fill-zinc-700"
                  style={{ fontSize: 11 }}
                >
                  {truncate(row.label, 18)}
                </text>
                <line
                  x1={ROW_LABEL_WIDTH}
                  x2={ROW_LABEL_WIDTH + CANVAS_WIDTH + CANVAS_PAD_X}
                  y1={y + ROW_HEIGHT / 2}
                  y2={y + ROW_HEIGHT / 2}
                  className="stroke-zinc-200"
                  strokeWidth={1}
                  strokeDasharray="2,3"
                />
                {row.bars.map((bar) => {
                  const layout = layoutFor(bar, range, rowIndex);
                  const isHover = hoverId === bar.id;
                  return (
                    <g key={bar.id}>
                      <rect
                        x={layout.x}
                        y={layout.y}
                        width={layout.width}
                        height={ROW_HEIGHT}
                        rx={4}
                        ry={4}
                        className={`${STATUS_FILL[bar.status]} ${
                          isHover ? 'opacity-100' : 'opacity-90'
                        } ${props.onSelect ? 'cursor-pointer' : ''}`}
                        onMouseEnter={() => setHoverId(bar.id)}
                        onMouseLeave={() => setHoverId((c) => (c === bar.id ? null : c))}
                        onClick={() => props.onSelect?.(bar.id)}
                        onKeyDown={(e) => {
                          if (props.onSelect && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            props.onSelect(bar.id);
                          }
                        }}
                        tabIndex={props.onSelect ? 0 : -1}
                        data-gantt-bar-id={bar.id}
                        data-gantt-bar-status={bar.status}
                      >
                        <title>{tooltipText(bar)}</title>
                      </rect>
                      {layout.width > 60 ? (
                        <text
                          x={layout.x + 6}
                          y={layout.y + ROW_HEIGHT * 0.7}
                          className="fill-white pointer-events-none"
                          style={{ fontSize: 10 }}
                        >
                          {truncate(bar.label, 14)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        {hoverBar ? (
          <div
            role="status"
            className="mt-2 rounded border border-border bg-surface-sunken p-2 text-[11px]"
            data-gantt-hover-card
          >
            <div className="font-semibold text-foreground">{hoverBar.label}</div>
            <div className={STATUS_TEXT[hoverBar.status]}>{STATUS_LABEL[hoverBar.status]}</div>
            <div className="text-muted-foreground">
              {hoverBar.startedAt} → {hoverBar.endedAt}
            </div>
          </div>
        ) : null}
        <div
          className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground"
          data-gantt-legend
        >
          {(['queued', 'running', 'success', 'failed'] as ReadonlyArray<GanttBarStatus>).map(
            (status) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded ${STATUS_FILL[status].replace(
                    'fill-',
                    'bg-',
                  )}`}
                />
                {STATUS_LABEL[status]}
              </span>
            ),
          )}
        </div>
      </div>
    </Frame>
  );
}
