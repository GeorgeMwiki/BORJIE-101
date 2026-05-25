/**
 * BORJIE gateway metrics registry — Wave-12 observability.
 *
 * Prometheus-shaped (counters, histograms, gauges) but served via a
 * simple admin JSON endpoint instead of the Prom text format. This is
 * intentional — we want a human-readable first pass for the SystemHealth
 * admin panel, not a pull-based Prom scrape target. If and when we add a
 * real Prom exporter it sits on top of the same registry.
 *
 * Zero-dependency, in-process, thread-safe within a single Node runtime
 * (Node is single-threaded for JS). Counters and histograms are
 * monotonically increasing; gauges can go up or down.
 *
 * Snapshot shape is documented in `MetricsSnapshot` — the /metrics route
 * returns exactly this shape.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CounterSnapshot {
  readonly name: string;
  readonly description: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface GaugeSnapshot {
  readonly name: string;
  readonly description: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface HistogramSnapshot {
  readonly name: string;
  readonly description: string;
  readonly count: number;
  readonly sum: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface MetricsSnapshot {
  readonly collectedAt: string;
  readonly uptimeSeconds: number;
  readonly counters: readonly CounterSnapshot[];
  readonly gauges: readonly GaugeSnapshot[];
  readonly histograms: readonly HistogramSnapshot[];
}

// ---------------------------------------------------------------------------
// Internal bucket structures (immutable-copy-on-update style where feasible)
// ---------------------------------------------------------------------------

interface CounterBucket {
  readonly name: string;
  readonly description: string;
  readonly labels: Readonly<Record<string, string>>;
  value: number;
}

interface GaugeBucket {
  readonly name: string;
  readonly description: string;
  readonly labels: Readonly<Record<string, string>>;
  value: number;
}

interface HistogramBucket {
  readonly name: string;
  readonly description: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly samples: number[];
  sum: number;
  count: number;
  min: number;
  max: number;
}

const LABEL_SEP = '\u0001';
function keyFor(name: string, labels: Readonly<Record<string, string>>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return name + LABEL_SEP + entries.map(([k, v]) => `${k}=${v}`).join(',');
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface MetricsRegistry {
  counter(
    name: string,
    description: string,
    labels?: Readonly<Record<string, string>>,
    by?: number,
  ): void;
  gauge(
    name: string,
    description: string,
    value: number,
    labels?: Readonly<Record<string, string>>,
  ): void;
  observe(
    name: string,
    description: string,
    sample: number,
    labels?: Readonly<Record<string, string>>,
  ): void;
  snapshot(): MetricsSnapshot;
  reset(): void;
}

export function createMetricsRegistry(deps: { now?: () => Date } = {}): MetricsRegistry {
  const startedAt = Date.now();
  const now = deps.now ?? (() => new Date());
  const counters = new Map<string, CounterBucket>();
  const gauges = new Map<string, GaugeBucket>();
  const histograms = new Map<string, HistogramBucket>();
  const MAX_SAMPLES = 1024;

  return {
    counter(name, description, labels = {}, by = 1) {
      const k = keyFor(name, labels);
      const existing = counters.get(k);
      if (existing) {
        existing.value += by;
      } else {
        counters.set(k, { name, description, labels: { ...labels }, value: by });
      }
    },
    gauge(name, description, value, labels = {}) {
      const k = keyFor(name, labels);
      gauges.set(k, { name, description, labels: { ...labels }, value });
    },
    observe(name, description, sample, labels = {}) {
      const k = keyFor(name, labels);
      const existing = histograms.get(k);
      if (existing) {
        existing.samples.push(sample);
        if (existing.samples.length > MAX_SAMPLES) existing.samples.shift();
        existing.sum += sample;
        existing.count += 1;
        existing.min = Math.min(existing.min, sample);
        existing.max = Math.max(existing.max, sample);
      } else {
        histograms.set(k, {
          name,
          description,
          labels: { ...labels },
          samples: [sample],
          sum: sample,
          count: 1,
          min: sample,
          max: sample,
        });
      }
    },
    snapshot() {
      const counterList: CounterSnapshot[] = [];
      for (const c of counters.values()) {
        counterList.push({
          name: c.name,
          description: c.description,
          value: c.value,
          labels: c.labels,
        });
      }
      const gaugeList: GaugeSnapshot[] = [];
      for (const g of gauges.values()) {
        gaugeList.push({
          name: g.name,
          description: g.description,
          value: g.value,
          labels: g.labels,
        });
      }
      const histList: HistogramSnapshot[] = [];
      for (const h of histograms.values()) {
        const sorted = [...h.samples].sort((a, b) => a - b);
        histList.push({
          name: h.name,
          description: h.description,
          labels: h.labels,
          count: h.count,
          sum: h.sum,
          min: h.min,
          max: h.max,
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
        });
      }
      return {
        collectedAt: now().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        counters: counterList,
        gauges: gaugeList,
        histograms: histList,
      };
    },
    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton — the gateway composes exactly one.
// ---------------------------------------------------------------------------

let singleton: MetricsRegistry | null = null;

export function getMetricsRegistry(): MetricsRegistry {
  if (!singleton) {
    singleton = createMetricsRegistry();
  }
  return singleton;
}

// ---------------------------------------------------------------------------
// Typed recorders — keep call sites free of string-typo bugs.
// ---------------------------------------------------------------------------

export function recordBrainTurn(input: {
  readonly persona: string;
  readonly tenantId: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
  readonly ok: boolean;
}): void {
  const r = getMetricsRegistry();
  const labels = { persona: input.persona, tenantId: input.tenantId };
  r.counter('brain.turn.total', 'Total brain-chat turns', labels);
  if (!input.ok) {
    r.counter('brain.turn.error.total', 'Failed brain-chat turns', labels);
  }
  r.observe('brain.turn.latency_ms', 'Brain turn latency (ms)', input.latencyMs, labels);
  r.observe(
    'brain.turn.input_tokens',
    'Brain turn input tokens',
    input.inputTokens,
    labels,
  );
  r.observe(
    'brain.turn.output_tokens',
    'Brain turn output tokens',
    input.outputTokens,
    labels,
  );
  r.counter(
    'brain.turn.cost_usd_micro.total',
    'Brain turn cumulative cost (microdollars)',
    labels,
    input.costUsdMicro,
  );
}

export function recordHeartbeatTick(input: {
  readonly personaCount: number;
  readonly lastTickAgoMs: number;
  readonly juniorSleepCount: number;
}): void {
  const r = getMetricsRegistry();
  r.counter('heartbeat.tick.total', 'Total heartbeat ticks');
  r.gauge('heartbeat.active_personas', 'Active brain personas right now', input.personaCount);
  r.gauge('heartbeat.last_tick_ago_ms', 'Milliseconds since last heartbeat tick', input.lastTickAgoMs);
  r.gauge('heartbeat.junior_sleep_count', 'Junior brains currently sleeping', input.juniorSleepCount);
}

export function recordBackgroundTask(input: {
  readonly kind: string;
  readonly tenantId: string;
  readonly ok: boolean;
  readonly durationMs: number;
}): void {
  const r = getMetricsRegistry();
  const labels = { kind: input.kind, tenantId: input.tenantId };
  r.counter('bg.task.total', 'Total background-task runs', labels);
  r.counter(
    input.ok ? 'bg.task.success.total' : 'bg.task.failure.total',
    'Background-task success/failure tally',
    labels,
  );
  r.observe('bg.task.duration_ms', 'Background-task duration (ms)', input.durationMs, labels);
}

export function recordMcpCall(input: {
  readonly tool: string;
  readonly tenantId: string;
  readonly ok: boolean;
  readonly latencyMs: number;
}): void {
  const r = getMetricsRegistry();
  const labels = { tool: input.tool, tenantId: input.tenantId };
  r.counter('mcp.call.total', 'Total MCP tool calls', labels);
  if (!input.ok) r.counter('mcp.call.error.total', 'Failed MCP tool calls', labels);
  r.observe('mcp.call.latency_ms', 'MCP tool call latency (ms)', input.latencyMs, labels);
}

export function recordVoiceCall(input: {
  readonly op: 'stt' | 'tts';
  readonly tenantId: string;
  readonly durationMs: number;
  readonly bytes: number;
}): void {
  const r = getMetricsRegistry();
  const labels = { op: input.op, tenantId: input.tenantId };
  r.counter('voice.call.total', 'Total voice-pipeline calls', labels);
  r.observe('voice.call.duration_ms', 'Voice call duration (ms)', input.durationMs, labels);
  r.observe('voice.call.bytes', 'Voice payload size (bytes)', input.bytes, labels);
}

export function recordStreamingEvent(input: {
  readonly kind: 'delta' | 'block' | 'done' | 'error';
  readonly tenantId: string;
}): void {
  const r = getMetricsRegistry();
  const labels = { kind: input.kind, tenantId: input.tenantId };
  r.counter('stream.event.total', 'Total SSE stream events emitted', labels);
}

export function recordCircuitBreakerState(input: {
  readonly breaker: string;
  readonly state: 'closed' | 'open' | 'half-open';
}): void {
  const r = getMetricsRegistry();
  // Gauge value: 0=closed, 1=half-open, 2=open. Easier to plot than a string.
  const numeric = input.state === 'closed' ? 0 : input.state === 'half-open' ? 1 : 2;
  r.gauge(
    'circuit.breaker.state',
    'Circuit-breaker numeric state (0=closed,1=half-open,2=open)',
    numeric,
    { breaker: input.breaker },
  );
}
