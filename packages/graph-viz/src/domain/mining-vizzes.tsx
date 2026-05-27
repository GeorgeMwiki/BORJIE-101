'use client';

/**
 * Mr. Mwikila — mining-domain viz wrappers.
 *
 * One thin wrapper per chart-type the mining auditor persona needs:
 *
 *   - LicenceRelationshipGraph — directed graph of licence holders +
 *     their related parties (subsidiaries, JVs, royalty payers,
 *     transporters, buyers). Renders via Cytoscape for ≤1k nodes.
 *
 *   - SupplyChainSankey        — flow diagram of tonnes moving
 *     between extraction → haulage → beneficiation → smelter →
 *     export → buyer.
 *
 *   - WorkerShiftGantt         — Gantt-style band of worker shifts
 *     across a day/week. Pure SVG so it never SSR-fails.
 *
 *   - RoyaltyFlowSankey        — flow of royalty payments from
 *     operators → jurisdictions → final accounts.
 *
 *   - MineralPriceWithForecast — historical commodity price line +
 *     forecast envelope. Consumes the conformal `ForecastResult`
 *     shape from `@borjie/forecasting`.
 *
 * Every wrapper takes domain-typed inputs (no `unknown`), projects
 * them into the engine-agnostic types, and forwards. The persona name
 * "Mr. Mwikila" is propagated only as the default ARIA label prefix
 * so screen readers anchor the user in the right mental model.
 */

import { useMemo } from 'react';
import { CytoscapeView } from '../components/CytoscapeView';
import { SankeyView } from '../components/SankeyView';
import { TimeSeriesWithForecast } from '../components/TimeSeriesWithForecast';
import { getBrandTheme, pickCategoricalColor } from '../themes/oklch-brand-theme';
import type {
  GraphNode,
  GraphEdge,
  MiningLicence,
  MiningLicenceRelationship,
  SupplyChainStage,
  SupplyChainFlow,
  WorkerShift,
  RoyaltyFlow,
  MineralPriceHistory,
  SankeyNode,
  SankeyLink,
} from '../types';

export const MR_MWIKILA_PERSONA = 'Mr. Mwikila';

// ─────────────────────────────────────────────────────────────────────
// LicenceRelationshipGraph
// ─────────────────────────────────────────────────────────────────────

export interface LicenceRelationshipGraphProps {
  readonly licences: ReadonlyArray<MiningLicence>;
  readonly relationships: ReadonlyArray<MiningLicenceRelationship>;
  readonly height?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function buildLicenceGraphProps(props: LicenceRelationshipGraphProps): {
  nodes: ReadonlyArray<GraphNode>;
  edges: ReadonlyArray<GraphEdge>;
} {
  const nodes: ReadonlyArray<GraphNode> = props.licences.map((l) => ({
    id: l.licenceId,
    label: `${l.holder} — ${l.mineral}`,
    kind: `status-${l.status}`,
    data: {
      holder: l.holder,
      mineral: l.mineral,
      jurisdiction: l.jurisdiction,
      status: l.status,
    },
  }));
  const edges: ReadonlyArray<GraphEdge> = props.relationships.map((r, i) => ({
    id: `${r.source}->${r.target}-${i}`,
    source: r.source,
    target: r.target,
    label: r.relation,
    kind: r.relation,
    directed: true,
  }));
  return { nodes, edges };
}

export function LicenceRelationshipGraph(props: LicenceRelationshipGraphProps): JSX.Element {
  const { nodes, edges } = buildLicenceGraphProps(props);
  return (
    <CytoscapeView
      nodes={nodes}
      edges={edges}
      layout={{ name: 'dagre', animate: false }}
      height={props.height ?? 480}
      themeName={props.themeName ?? 'brand-light'}
      ariaLabel={props.ariaLabel ?? `${MR_MWIKILA_PERSONA}: licence relationship graph (${nodes.length} licences)`}
      testId={props.testId ?? 'mining-licence-relationship-graph'}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// SupplyChainSankey
// ─────────────────────────────────────────────────────────────────────

export interface SupplyChainSankeyProps {
  readonly stages: ReadonlyArray<SupplyChainStage>;
  readonly flows: ReadonlyArray<SupplyChainFlow>;
  readonly unitLabel?: string;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function buildSupplyChainSankeyProps(props: SupplyChainSankeyProps): {
  nodes: ReadonlyArray<SankeyNode>;
  links: ReadonlyArray<SankeyLink>;
} {
  const theme = getBrandTheme(props.themeName);
  const nodes: ReadonlyArray<SankeyNode> = props.stages.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.stage,
    color: pickCategoricalColor(theme, s.stage).hex,
  }));
  const links: ReadonlyArray<SankeyLink> = props.flows
    .filter((f) => f.tonnes > 0)
    .map((f) => ({ source: f.source, target: f.target, value: f.tonnes }));
  return { nodes, links };
}

export function SupplyChainSankey(props: SupplyChainSankeyProps): JSX.Element {
  const { nodes, links } = buildSupplyChainSankeyProps(props);
  return (
    <SankeyView
      nodes={nodes}
      links={links}
      unitLabel={props.unitLabel ?? 'tonnes'}
      height={props.height ?? 360}
      width={props.width ?? 720}
      themeName={props.themeName ?? 'brand-light'}
      ariaLabel={
        props.ariaLabel
        ?? `${MR_MWIKILA_PERSONA}: supply-chain flow Sankey, ${nodes.length} stages, ${links.length} flows`
      }
      testId={props.testId ?? 'mining-supply-chain-sankey'}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// WorkerShiftGantt
// ─────────────────────────────────────────────────────────────────────

export interface WorkerShiftGanttProps {
  readonly shifts: ReadonlyArray<WorkerShift>;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel?: string;
  readonly testId?: string;
}

interface GanttRow {
  readonly workerId: string;
  readonly workerName: string;
  readonly bars: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly status: WorkerShift['status'];
    readonly role: string;
  }>;
}

export function buildGanttRows(shifts: ReadonlyArray<WorkerShift>): {
  rows: ReadonlyArray<GanttRow>;
  minMs: number;
  maxMs: number;
} {
  const byWorker = new Map<string, GanttRow>();
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const s of shifts) {
    const start = new Date(s.start).getTime();
    const end = new Date(s.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    minMs = Math.min(minMs, start);
    maxMs = Math.max(maxMs, end);
    const existing = byWorker.get(s.workerId);
    const bar = { start, end, status: s.status, role: s.role };
    if (existing) {
      byWorker.set(s.workerId, {
        ...existing,
        bars: [...existing.bars, bar],
      });
    } else {
      byWorker.set(s.workerId, {
        workerId: s.workerId,
        workerName: s.workerName,
        bars: [bar],
      });
    }
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return { rows: [], minMs: 0, maxMs: 1 };
  }
  return { rows: Array.from(byWorker.values()), minMs, maxMs };
}

export function WorkerShiftGantt(props: WorkerShiftGanttProps): JSX.Element {
  const {
    shifts,
    height = 360,
    width = 720,
    themeName = 'brand-light',
    ariaLabel,
    testId,
  } = props;

  const theme = getBrandTheme(themeName);
  const { rows, minMs, maxMs } = useMemo(() => buildGanttRows(shifts), [shifts]);
  const padding = { top: 24, right: 16, bottom: 24, left: 130 };
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const rowH = rows.length > 0 ? Math.max(14, innerH / rows.length) : innerH;

  const statusColor = (status: WorkerShift['status']): string => {
    switch (status) {
      case 'completed':   return theme.sequential7[5]?.hex ?? theme.signal.hex;
      case 'in-progress': return theme.signal.hex;
      case 'planned':     return theme.sequential7[2]?.hex ?? theme.signal.hex;
      case 'absent':      return theme.muted.hex;
      default:            return theme.signal.hex;
    }
  };

  const x = (ms: number): number =>
    padding.left + ((ms - minMs) / Math.max(1, maxMs - minMs)) * innerW;

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? `${MR_MWIKILA_PERSONA}: worker-shift Gantt, ${rows.length} workers`}
      data-testid={testId ?? 'mining-worker-shift-gantt'}
      width={width}
      height={height}
      style={{ background: theme.background.hex, borderRadius: 8 }}
    >
      <title>{ariaLabel ?? `${MR_MWIKILA_PERSONA}: worker-shift Gantt`}</title>
      {rows.map((r, i) => {
        const y = padding.top + i * rowH;
        return (
          <g key={r.workerId}>
            <text x={8} y={y + rowH / 2 + 4} fontSize={11} fill={theme.foreground.hex}>
              {r.workerName}
            </text>
            <line
              x1={padding.left} y1={y + rowH - 1}
              x2={width - padding.right} y2={y + rowH - 1}
              stroke={theme.border.hex}
            />
            {r.bars.map((b, j) => (
              <rect
                key={j}
                x={x(b.start)}
                y={y + 4}
                width={Math.max(2, x(b.end) - x(b.start))}
                height={rowH - 8}
                rx={3}
                fill={statusColor(b.status)}
                opacity={b.status === 'absent' ? 0.4 : 0.9}
              >
                <title>{`${r.workerName} — ${b.role} (${b.status})`}</title>
              </rect>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// RoyaltyFlowSankey
// ─────────────────────────────────────────────────────────────────────

export interface RoyaltyFlowSankeyProps {
  readonly flows: ReadonlyArray<RoyaltyFlow>;
  readonly currency?: string;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function buildRoyaltySankeyProps(props: RoyaltyFlowSankeyProps): {
  nodes: ReadonlyArray<SankeyNode>;
  links: ReadonlyArray<SankeyLink>;
  totalAmount: number;
  currency: string;
} {
  const theme = getBrandTheme(props.themeName);
  const ids = new Set<string>();
  for (const f of props.flows) {
    ids.add(f.source);
    ids.add(f.target);
  }
  const nodes: ReadonlyArray<SankeyNode> = Array.from(ids).map((id) => ({
    id,
    name: id,
    color: pickCategoricalColor(theme, id).hex,
  }));
  let total = 0;
  const links: ReadonlyArray<SankeyLink> = props.flows
    .filter((f) => f.amount > 0)
    .map((f) => {
      total += f.amount;
      return { source: f.source, target: f.target, value: f.amount };
    });
  // Currency: prefer caller; fall back to the first flow's currency,
  // or 'TZS' as the Mr. Mwikila default jurisdiction.
  const currency =
    props.currency
    ?? props.flows[0]?.currency
    ?? 'TZS';
  return { nodes, links, totalAmount: total, currency };
}

export function RoyaltyFlowSankey(props: RoyaltyFlowSankeyProps): JSX.Element {
  const { nodes, links, currency } = buildRoyaltySankeyProps(props);
  return (
    <SankeyView
      nodes={nodes}
      links={links}
      unitLabel={currency}
      height={props.height ?? 360}
      width={props.width ?? 720}
      themeName={props.themeName ?? 'brand-light'}
      ariaLabel={
        props.ariaLabel
        ?? `${MR_MWIKILA_PERSONA}: royalty flow Sankey in ${currency}, ${links.length} flows`
      }
      testId={props.testId ?? 'mining-royalty-flow-sankey'}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// MineralPriceWithForecast
// ─────────────────────────────────────────────────────────────────────

export interface MineralPriceWithForecastProps {
  readonly priceHistory: MineralPriceHistory;
  readonly height?: number;
  readonly width?: number;
  readonly themeName?: 'brand-light' | 'brand-dark';
  readonly ariaLabel?: string;
  readonly testId?: string;
}

export function MineralPriceWithForecast(props: MineralPriceWithForecastProps): JSX.Element {
  const { priceHistory } = props;
  return (
    <TimeSeriesWithForecast
      historical={priceHistory.historical}
      forecast={priceHistory.forecast}
      seriesName={priceHistory.mineral}
      unit={priceHistory.unit}
      height={props.height ?? 320}
      width={props.width ?? 720}
      themeName={props.themeName ?? 'brand-light'}
      ariaLabel={
        props.ariaLabel
        ?? `${MR_MWIKILA_PERSONA}: ${priceHistory.mineral} price (${priceHistory.unit}) with forecast`
      }
      testId={props.testId ?? 'mining-mineral-price-with-forecast'}
    />
  );
}
