'use client';

/**
 * SystemHealth — internal ops dashboard. Migrated from
 * apps/admin-portal/src/pages/SystemHealth.tsx.
 *
 * Polls GET /api/v1/metrics every 5s and renders the key operational
 * gauges the on-call team needs at a glance.
 */

import { useEffect, useMemo, useState } from 'react';

interface CounterSnapshot {
  name: string;
  description: string;
  value: number;
  labels: Record<string, string>;
}

interface GaugeSnapshot {
  name: string;
  description: string;
  value: number;
  labels: Record<string, string>;
}

interface HistogramSnapshot {
  name: string;
  description: string;
  count: number;
  sum: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  labels: Record<string, string>;
}

interface MetricsSnapshot {
  collectedAt: string;
  uptimeSeconds: number;
  counters: CounterSnapshot[];
  gauges: GaugeSnapshot[];
  histograms: HistogramSnapshot[];
}

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly snapshot: MetricsSnapshot | null;
  readonly error: string | null;
  readonly lastFetchedAt: number | null;
}

const POLL_INTERVAL_MS = 5000;

function metricsEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    const base = trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
    return `${base}/metrics`;
  }
  return '/api/v1/metrics';
}

function sumCounter(snap: MetricsSnapshot, name: string): number {
  return snap.counters
    .filter((c) => c.name === name)
    .reduce((acc, c) => acc + c.value, 0);
}

function histogramByName(
  snap: MetricsSnapshot,
  name: string,
): HistogramSnapshot | null {
  const all = snap.histograms.filter((h) => h.name === name);
  if (all.length === 0) return null;
  const count = all.reduce((a, h) => a + h.count, 0);
  if (count === 0) return null;
  const sum = all.reduce((a, h) => a + h.sum, 0);
  const p50 = all.reduce((a, h) => a + h.p50 * h.count, 0) / count;
  const p95 = all.reduce((a, h) => a + h.p95 * h.count, 0) / count;
  const p99 = all.reduce((a, h) => a + h.p99 * h.count, 0) / count;
  const min = Math.min(...all.map((h) => h.min));
  const max = Math.max(...all.map((h) => h.max));
  return {
    name,
    description: all[0].description,
    count,
    sum,
    p50,
    p95,
    p99,
    min,
    max,
    labels: {},
  };
}

function gaugeByName(
  snap: MetricsSnapshot,
  name: string,
): GaugeSnapshot | null {
  return snap.gauges.find((g) => g.name === name) ?? null;
}

function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

function formatMs(v: number | null): string {
  if (v === null) return 'n/a';
  return `${v.toFixed(0)} ms`;
}

function breakerStateLabel(n: number): string {
  if (n === 0) return 'closed';
  if (n === 1) return 'half-open';
  return 'open';
}

interface CardProps {
  readonly title: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: 'ok' | 'warn' | 'bad';
}

function Card({ title, value, sub, tone = 'ok' }: CardProps) {
  const toneClass =
    tone === 'bad'
      ? 'border-rose-500/40 bg-rose-500/5'
      : tone === 'warn'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-border bg-surface';
  return (
    <div
      data-testid={`health-card-${title.toLowerCase().replace(/\s+/g, '-')}`}
      className={`rounded-xl border ${toneClass} p-4 min-w-[200px] flex-1`}
    >
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {title}
      </div>
      <div className="mt-1 text-2xl font-display text-foreground">{value}</div>
      {sub ? <div className="mt-1 text-xs text-neutral-400">{sub}</div> : null}
    </div>
  );
}

export function SystemHealthClient() {
  const [state, setState] = useState<FetchState>({
    status: 'idle',
    snapshot: null,
    error: null,
    lastFetchedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    const endpoint = metricsEndpoint();

    const tick = async () => {
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        status: prev.snapshot ? 'ok' : 'loading',
      }));
      try {
        // Auth: the httpOnly platform-session cookie rides via
        // `credentials: 'include'`. If a bearer is also stashed in
        // sessionStorage (login flow may put one there for callers
        // that can't use cookies) forward it on the Authorization
        // header — matches the lib/api.ts pattern.
        const token =
          typeof window !== 'undefined'
            ? window.sessionStorage.getItem('platform_token')
            : null;
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`Metrics endpoint returned ${res.status}`);
        }
        const body = (await res.json()) as {
          success: boolean;
          data?: MetricsSnapshot;
        };
        if (!body.success || !body.data) {
          throw new Error('Metrics endpoint returned an unexpected envelope');
        }
        if (cancelled) return;
        setState({
          status: 'ok',
          snapshot: body.data,
          error: null,
          lastFetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          status: 'error',
          snapshot: prev.snapshot,
          error: err instanceof Error ? err.message : 'unknown',
          lastFetchedAt: prev.lastFetchedAt,
        }));
      }
    };

    void tick();
    const handle = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const derived = useMemo(() => {
    if (!state.snapshot) return null;
    const snap = state.snapshot;
    const turns = sumCounter(snap, 'brain.turn.total');
    const costMicro = sumCounter(snap, 'brain.turn.cost_usd_micro.total');
    const errors = sumCounter(snap, 'brain.turn.error.total');
    const streamEvents = sumCounter(snap, 'stream.event.total');
    const bgSuccess = sumCounter(snap, 'bg.task.success.total');
    const bgFailure = sumCounter(snap, 'bg.task.failure.total');
    const bgTotal = bgSuccess + bgFailure;
    const bgRate = bgTotal === 0 ? null : (bgSuccess / bgTotal) * 100;
    const latencyHist = histogramByName(snap, 'brain.turn.latency_ms');
    const activePersonas = gaugeByName(snap, 'heartbeat.active_personas');
    const lastTickAgo = gaugeByName(snap, 'heartbeat.last_tick_ago_ms');
    const sleepCount = gaugeByName(snap, 'heartbeat.junior_sleep_count');
    const breakerGauges = snap.gauges.filter(
      (g) => g.name === 'circuit.breaker.state',
    );
    const uptimeMinutes = Math.floor(snap.uptimeSeconds / 60);
    const eventsPerSecond =
      snap.uptimeSeconds === 0 ? 0 : streamEvents / snap.uptimeSeconds;
    return {
      turns,
      errors,
      costMicro,
      streamEvents,
      bgSuccess,
      bgFailure,
      bgRate,
      latencyHist,
      activePersonas,
      lastTickAgo,
      sleepCount,
      breakerGauges,
      uptimeMinutes,
      eventsPerSecond,
    };
  }, [state.snapshot]);

  return (
    <div data-testid="system-health-root" className="space-y-6">
      <p
        data-testid="system-health-status"
        className="text-xs text-neutral-500"
      >
        Status: {state.status}
        {state.lastFetchedAt
          ? ` — last poll ${Math.floor((Date.now() - state.lastFetchedAt) / 1000)}s ago`
          : ''}
        {state.error ? ` — error: ${state.error}` : ''}
      </p>

      {!derived ? (
        <div data-testid="system-health-empty" className="text-sm text-neutral-400">
          Loading…
        </div>
      ) : (
        <>
          <section
            data-testid="system-health-primary-cards"
            className="flex flex-wrap gap-3"
          >
            <Card
              title="Uptime"
              value={`${derived.uptimeMinutes} min`}
              sub="Process uptime"
            />
            <Card
              title="Events / sec"
              value={derived.eventsPerSecond.toFixed(2)}
              sub={`${derived.streamEvents} total stream events`}
            />
            <Card
              title="Latency"
              value={formatMs(derived.latencyHist?.p50 ?? null)}
              sub={`p95 ${formatMs(derived.latencyHist?.p95 ?? null)} / p99 ${formatMs(derived.latencyHist?.p99 ?? null)}`}
            />
            <Card
              title="Today's spend"
              value={formatUsd(derived.costMicro)}
              sub={`${derived.turns} turns / ${derived.errors} errors`}
              tone={derived.errors > 0 ? 'warn' : 'ok'}
            />
            <Card
              title="Active personas"
              value={String(derived.activePersonas?.value ?? 'n/a')}
            />
            <Card
              title="Heartbeat"
              value={formatMs(derived.lastTickAgo?.value ?? null)}
              tone={
                (derived.lastTickAgo?.value ?? 0) > 30_000
                  ? 'bad'
                  : (derived.lastTickAgo?.value ?? 0) > 10_000
                    ? 'warn'
                    : 'ok'
              }
            />
            <Card
              title="Junior asleep"
              value={String(derived.sleepCount?.value ?? 'n/a')}
            />
            <Card
              title="Bg success rate"
              value={
                derived.bgRate === null ? 'n/a' : `${derived.bgRate.toFixed(1)}%`
              }
              sub={`${derived.bgSuccess} ok / ${derived.bgFailure} failed`}
              tone={
                derived.bgRate !== null && derived.bgRate < 80
                  ? 'bad'
                  : derived.bgRate !== null && derived.bgRate < 95
                    ? 'warn'
                    : 'ok'
              }
            />
          </section>

          <section data-testid="system-health-breakers">
            <h2 className="mb-2 font-display text-foreground">Circuit breakers</h2>
            {derived.breakerGauges.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No breaker gauges reported.
              </p>
            ) : (
              <ul className="space-y-1 text-sm text-neutral-200">
                {derived.breakerGauges.map((g) => {
                  const breakerName = g.labels.breaker ?? 'unknown';
                  return (
                    <li
                      key={breakerName}
                      data-testid={`breaker-${breakerName}`}
                    >
                      <strong className="text-foreground">{breakerName}:</strong>{' '}
                      {breakerStateLabel(g.value)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <details className="text-xs text-neutral-400">
            <summary className="cursor-pointer">Raw snapshot</summary>
            <pre data-testid="system-health-raw" className="mt-2 overflow-x-auto">
              {JSON.stringify(state.snapshot, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
