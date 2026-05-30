/**
 * Redesign proposer — given a mined map, a bottleneck list, and an
 * optional set of citations from web research, propose a concrete
 * `RedesignProposalInput` that the owner can approve.
 *
 * The proposer is deterministic and rule-based:
 *
 *   - wait_time       on edge (A → B)  →  parallelise(A, B) OR
 *                                          add automated handoff
 *   - rework_loop     on node A        →  introduce_decision before A
 *   - parallel_gap    on node A        →  add_activity "synchroniser"
 *                                          inbound to A
 *   - low_throughput  on node A        →  consolidate_activities with
 *                                          adjacent low-traffic node
 *   - high_variance   on node A        →  automate_activity(A)
 *
 * Expected impact is computed from observed bottleneck severities so
 * the owner sees grounded numbers, not LLM-confabulated optimism. A
 * future iteration can plug an LLM in to write the rationale prose
 * — the function shape is stable.
 *
 * @module features/central-command/md/process-mining/redesign-proposer
 */

import type {
  Bottleneck,
  Citation,
  ExpectedImpact,
  ProcessMapMetrics,
  RedesignChange,
  RedesignChangeKind,
  RedesignProposalInput,
} from "./types";

export interface ProposeRedesignInput {
  readonly orgId: string;
  readonly processKey: string;
  readonly baseMapId: string;
  readonly metrics: ProcessMapMetrics;
  readonly bottlenecks: ReadonlyArray<Bottleneck>;
  readonly proposerId: string;
  readonly citations?: ReadonlyArray<Citation>;
  /** Optional cap on changeset size — most owners can stomach 3-5
   *  changes in one review cycle, not 16. Default 6. */
  readonly maxChanges?: number;
}

export function proposeRedesign(
  input: ProposeRedesignInput,
): RedesignProposalInput | null {
  if (input.bottlenecks.length === 0) return null;
  const maxChanges = Math.max(1, Math.min(16, input.maxChanges ?? 6));

  // Take the top N bottlenecks (already sorted by severity desc).
  const targets = input.bottlenecks.slice(0, maxChanges);
  const changes: RedesignChange[] = [];
  const seenTargets = new Set<string>();
  let cycleSavingPct = 0;

  for (const b of targets) {
    const targetLabel =
      "node" in b.anchor
        ? b.anchor.node
        : `${b.anchor.edge.from}→${b.anchor.edge.to}`;
    if (seenTargets.has(`${b.kind}::${targetLabel}`)) continue;
    seenTargets.add(`${b.kind}::${targetLabel}`);

    const change = mapBottleneckToChange(b, targetLabel);
    if (!change) continue;
    changes.push(change);
    // Heuristic: each change recovers (severity * 12%) of cycle time,
    // capped at 65% total — keeps the projected savings honest.
    cycleSavingPct = Math.min(65, cycleSavingPct + b.severity * 12);
  }

  if (changes.length === 0) return null;

  const expectedImpact: ExpectedImpact = {
    cycleTimeSavingPct: Number(cycleSavingPct.toFixed(1)),
    risks: [...deriveRisks(changes)],
  };

  return Object.freeze({
    orgId: input.orgId,
    processKey: input.processKey,
    baseMapId: input.baseMapId,
    proposerKind: "junior",
    proposerId: input.proposerId,
    changeset: Object.freeze(changes),
    expectedImpact,
    citations: input.citations
      ? Object.freeze([...input.citations])
      : undefined,
    rationale: buildRationale(input.metrics, input.bottlenecks, changes),
  }) as RedesignProposalInput;
}

// ---------------------------------------------------------------------------
// Bottleneck → change mapping
// ---------------------------------------------------------------------------

function mapBottleneckToChange(
  b: Bottleneck,
  targetLabel: string,
): RedesignChange | null {
  const kinds = {
    wait_time: "parallelise" as RedesignChangeKind,
    rework_loop: "introduce_decision" as RedesignChangeKind,
    parallel_gap: "add_activity" as RedesignChangeKind,
    low_throughput: "consolidate_activities" as RedesignChangeKind,
    high_variance: "automate_activity" as RedesignChangeKind,
  } as const;
  const kind = kinds[b.kind];
  if (!kind) return null;

  const description = describeChange(b, targetLabel);
  const invariants = deriveInvariants(b);
  return {
    kind,
    target: targetLabel.slice(0, 160),
    description,
    invariants: invariants ? [...invariants] : undefined,
  };
}

function describeChange(b: Bottleneck, target: string): string {
  switch (b.kind) {
    case "wait_time":
      return `Run "${target}" in parallel with adjacent steps or insert an automated handoff — currently the slowest edge in the map.`;
    case "rework_loop":
      return `Insert an explicit decision before "${target}" so cases that need rework are routed once instead of churning back through the same step.`;
    case "parallel_gap":
      return `Add a synchroniser before "${target}" so the slowest inbound branch doesn't gate the fast ones.`;
    case "low_throughput":
      return `"${target}" is rarely exercised — consider folding it into an adjacent step or removing it after confirming it's not a regulatory hold.`;
    case "high_variance":
      return `Automate "${target}" — its dwell variance suggests manual variance / unclear ownership.`;
    default:
      return `Adjust "${target}" to remove the detected bottleneck.`;
  }
}

function deriveInvariants(b: Bottleneck): ReadonlyArray<string> | undefined {
  switch (b.kind) {
    case "rework_loop":
      return [
        "The decision branch must preserve the original compliance check.",
      ];
    case "high_variance":
      return [
        "Automation must surface a manual-override path the operator can flip.",
      ];
    case "wait_time":
      return [
        "Parallel branches must remain auditable independently (separate decision-traces).",
      ];
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Impact + rationale
// ---------------------------------------------------------------------------

function deriveRisks(
  changes: ReadonlyArray<RedesignChange>,
): ReadonlyArray<string> {
  const risks: string[] = [];
  for (const c of changes) {
    if (c.kind === "automate_activity") {
      risks.push(
        `Automating "${c.target}" requires shadow-canary verification before activation; manual override path must stay reachable.`,
      );
    }
    if (c.kind === "parallelise") {
      risks.push(
        `Parallelising "${c.target}" may surface race conditions if downstream state isn't idempotent — verify with canary runs.`,
      );
    }
    if (c.kind === "consolidate_activities") {
      risks.push(
        `Consolidating "${c.target}" risks losing a compliance touchpoint if the absorbed step was a regulator-mandated control.`,
      );
    }
  }
  return Object.freeze(risks);
}

function buildRationale(
  metrics: ProcessMapMetrics,
  bottlenecks: ReadonlyArray<Bottleneck>,
  changes: ReadonlyArray<RedesignChange>,
): string {
  const top3 = bottlenecks.slice(0, 3);
  const lines: string[] = [];
  lines.push(
    `Window: ${metrics.traceCount} cases, ${metrics.distinctVariants} variants, p95 cycle time ${msToHuman(metrics.p95CaseDurationMs)}.`,
  );
  if (top3.length > 0) {
    lines.push(
      `Top issues: ${top3
        .map(
          (b) =>
            `${b.kind}@${"node" in b.anchor ? b.anchor.node : `${b.anchor.edge.from}→${b.anchor.edge.to}`} (severity ${(b.severity * 100).toFixed(0)}%)`,
        )
        .join("; ")}.`,
    );
  }
  lines.push(
    `Proposed ${changes.length} change${changes.length === 1 ? "" : "s"} mapped 1:1 from the diagnosis.`,
  );
  lines.push(
    "All changes require owner approval; automations go through a second 4-eye gate + shadow canary before activation.",
  );
  return lines.join(" ");
}

function msToHuman(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}
