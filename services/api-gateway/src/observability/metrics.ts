/**
 * Borjie kernel metrics — OTel `metrics` API surface.
 *
 * Provides a typed facade over the OTel meter so call sites cannot
 * accidentally drift the metric name or label keys (a common source of
 * Prometheus cardinality blow-ups). Histograms, counters and gauges are
 * registered lazily on first use; instrument names are stable across
 * boots so dashboards keep working through restarts.
 *
 * Cardinality discipline:
 *  - `surface`, `stakes`, `scopeKind` → bounded enums.
 *  - `sensorId`, `modelId` → bounded by the registered sensor catalogue.
 *  - Free-form labels (e.g. tenantId) are NOT recorded here; tenant
 *    breakdowns are captured by Prometheus relabel rules at the
 *    collector if needed.
 */

import {
  metrics,
  type Counter,
  type Histogram,
  type ObservableGauge,
  type Meter,
} from '@opentelemetry/api';

const METER_NAME = 'borjie.api-gateway';
const METER_VERSION = '1.0.0';

// Allowed label keys for each metric. Keys outside the allowlist are
// dropped to keep cardinality bounded.
const TURN_DURATION_LABELS = ['surface', 'stakes', 'scopeKind'] as const;
const TURN_TOTAL_LABELS = ['surface', 'decision_kind'] as const;
const SENSOR_DURATION_LABELS = ['sensorId', 'modelId'] as const;
const SENSOR_TOKEN_LABELS = ['sensorId'] as const;
const GATE_BLOCKED_LABELS = ['gate', 'surface'] as const;
const DRIFT_DETECTED_LABELS = ['violation_type'] as const;
const TENANT_BUDGET_LABELS = ['surface'] as const;

type LabelTuple = ReadonlyArray<string>;

function pickLabels(
  input: Record<string, string | number | undefined>,
  allowed: LabelTuple,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of allowed) {
    const v = input[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

interface KernelMetricsHandle {
  readonly meter: Meter;
  readonly turnDuration: Histogram;
  readonly sensorDuration: Histogram;
  readonly turnTotal: Counter;
  readonly gateBlockedTotal: Counter;
  readonly driftDetectedTotal: Counter;
  readonly tenantBudgetExceededTotal: Counter;
  readonly sensorTokensInputTotal: Counter;
  readonly sensorTokensOutputTotal: Counter;
  privacyBudgetEpsilon: number;
  readonly privacyBudgetGauge: ObservableGauge;
}

let handle: KernelMetricsHandle | null = null;

function build(): KernelMetricsHandle {
  const meter = metrics.getMeter(METER_NAME, METER_VERSION);

  const turnDuration = meter.createHistogram('borjie.kernel.turn.duration_ms', {
    description: 'Kernel turn duration in milliseconds',
    unit: 'ms',
  });
  const sensorDuration = meter.createHistogram(
    'borjie.sensor.call.duration_ms',
    {
      description: 'Sensor (LLM) call duration in milliseconds',
      unit: 'ms',
    },
  );
  const turnTotal = meter.createCounter('borjie.kernel.turn.total', {
    description: 'Total kernel turns processed',
  });
  const gateBlockedTotal = meter.createCounter(
    'borjie.kernel.gate.blocked.total',
    {
      description: 'Total kernel turns blocked by a gate',
    },
  );
  const driftDetectedTotal = meter.createCounter(
    'borjie.kernel.drift.detected.total',
    {
      description: 'Total drift violations detected by the kernel drift gate',
    },
  );
  const tenantBudgetExceededTotal = meter.createCounter(
    'borjie.tenant.budget.exceeded.total',
    {
      description: 'Total kernel turns rejected due to per-tenant token budget',
    },
  );
  const sensorTokensInputTotal = meter.createCounter(
    'borjie.sensor.tokens.input.total',
    {
      description: 'Total input tokens consumed by sensor calls',
    },
  );
  const sensorTokensOutputTotal = meter.createCounter(
    'borjie.sensor.tokens.output.total',
    {
      description: 'Total output tokens produced by sensor calls',
    },
  );

  // Privacy budget gauge — stored as a mutable cell on the handle and
  // observed each scrape interval.
  const privacyBudgetGauge = meter.createObservableGauge(
    'borjie.privacy_budget.remaining_epsilon',
    {
      description: 'Remaining privacy budget (DP epsilon) for the platform aggregator',
    },
  );
  const built: KernelMetricsHandle = {
    meter,
    turnDuration,
    sensorDuration,
    turnTotal,
    gateBlockedTotal,
    driftDetectedTotal,
    tenantBudgetExceededTotal,
    sensorTokensInputTotal,
    sensorTokensOutputTotal,
    privacyBudgetEpsilon: 0,
    privacyBudgetGauge,
  };
  privacyBudgetGauge.addCallback((result) => {
    result.observe(built.privacyBudgetEpsilon);
  });
  return built;
}

function ensure(): KernelMetricsHandle {
  if (!handle) handle = build();
  return handle;
}

/**
 * Record a kernel turn outcome. Call once per finished
 * `kernel.think(req)` (success or refusal).
 */
export function recordKernelTurn(input: {
  readonly surface: string;
  readonly stakes: string;
  readonly scopeKind: string;
  readonly decisionKind: string;
  readonly durationMs: number;
}): void {
  const h = ensure();
  h.turnDuration.record(
    input.durationMs,
    pickLabels(
      { surface: input.surface, stakes: input.stakes, scopeKind: input.scopeKind },
      TURN_DURATION_LABELS,
    ),
  );
  h.turnTotal.add(
    1,
    pickLabels(
      { surface: input.surface, decision_kind: input.decisionKind },
      TURN_TOTAL_LABELS,
    ),
  );
}

/**
 * Record a sensor call duration + token cost.
 */
export function recordSensorCall(input: {
  readonly sensorId: string;
  readonly modelId: string;
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}): void {
  const h = ensure();
  h.sensorDuration.record(
    input.durationMs,
    pickLabels(
      { sensorId: input.sensorId, modelId: input.modelId },
      SENSOR_DURATION_LABELS,
    ),
  );
  if (typeof input.inputTokens === 'number' && input.inputTokens > 0) {
    h.sensorTokensInputTotal.add(
      input.inputTokens,
      pickLabels({ sensorId: input.sensorId }, SENSOR_TOKEN_LABELS),
    );
  }
  if (typeof input.outputTokens === 'number' && input.outputTokens > 0) {
    h.sensorTokensOutputTotal.add(
      input.outputTokens,
      pickLabels({ sensorId: input.sensorId }, SENSOR_TOKEN_LABELS),
    );
  }
}

/** Bump the gate-blocked counter (inviolable / policy / drift). */
export function recordGateBlocked(input: {
  readonly gate: 'inviolable' | 'policy' | 'drift' | string;
  readonly surface: string;
}): void {
  const h = ensure();
  h.gateBlockedTotal.add(
    1,
    pickLabels({ gate: input.gate, surface: input.surface }, GATE_BLOCKED_LABELS),
  );
}

/** Bump the drift-violation counter (typed by violation kind). */
export function recordDriftDetected(input: {
  readonly violationType: string;
}): void {
  const h = ensure();
  h.driftDetectedTotal.add(
    1,
    pickLabels({ violation_type: input.violationType }, DRIFT_DETECTED_LABELS),
  );
}

/** Bump the per-tenant-budget rejection counter. */
export function recordTenantBudgetExceeded(input: {
  readonly surface: string;
}): void {
  const h = ensure();
  h.tenantBudgetExceededTotal.add(
    1,
    pickLabels({ surface: input.surface }, TENANT_BUDGET_LABELS),
  );
}

/** Update the privacy-budget remaining-epsilon gauge value. */
export function setPrivacyBudgetEpsilon(value: number): void {
  const h = ensure();
  h.privacyBudgetEpsilon = Math.max(0, value);
}

/** Read the current privacy-budget value (for reporting / tests). */
export function getPrivacyBudgetEpsilon(): number {
  return ensure().privacyBudgetEpsilon;
}

/** Test seam — wipes the cached handle so a fresh meter is used. */
export function __resetKernelMetricsForTests(): void {
  handle = null;
}

/** Public introspection — useful for tests that assert label allowlists. */
export const KERNEL_METRIC_LABELS = {
  turnDuration: TURN_DURATION_LABELS,
  turnTotal: TURN_TOTAL_LABELS,
  sensorDuration: SENSOR_DURATION_LABELS,
  sensorTokens: SENSOR_TOKEN_LABELS,
  gateBlocked: GATE_BLOCKED_LABELS,
  driftDetected: DRIFT_DETECTED_LABELS,
  tenantBudget: TENANT_BUDGET_LABELS,
} as const;
