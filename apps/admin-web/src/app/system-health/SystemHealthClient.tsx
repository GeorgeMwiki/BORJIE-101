'use client';

/**
 * SystemHealth — internal ops dashboard. Migrated from
 * apps/admin-portal/src/pages/SystemHealth.tsx.
 *
 * Polls GET /api/v1/metrics every 5s and renders the key operational
 * gauges the on-call team needs at a glance.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@borjie/design-system';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

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
    description: all[0]!.description,
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
  if (v === null) return '—';
  return `${v.toFixed(0)} ms`;
}

function breakerStateLabel(n: number, locale: Locale): string {
  if (n === 0) return pickByLocale(locale, { en: 'closed', sw: 'imefungwa' });
  if (n === 1)
    return pickByLocale(locale, { en: 'half-open', sw: 'nusu-wazi' });
  return pickByLocale(locale, { en: 'open', sw: 'wazi' });
}

interface MetricCardProps {
  readonly title: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: 'ok' | 'warn' | 'bad';
}

function MetricCard({ title, value, sub, tone = 'ok' }: MetricCardProps) {
  const toneClass =
    tone === 'bad'
      ? 'border-danger/40 bg-danger/5'
      : tone === 'warn'
        ? 'border-warning/40 bg-warning/5'
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

export function SystemHealthClient({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}) {
  // Seed from the server-resolved cookie to avoid the first-paint split-brain.
  const locale = useLocale(initialLocale);
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

  const statusLabel = pickByLocale(locale, {
    en: STATUS_LABEL_EN[state.status],
    sw: STATUS_LABEL_SW[state.status],
  });
  const lastPoll =
    state.lastFetchedAt !== null
      ? Math.floor((Date.now() - state.lastFetchedAt) / 1000)
      : null;

  return (
    <div data-testid="system-health-root" className="space-y-6">
      <p
        data-testid="system-health-status"
        className="text-xs text-neutral-500"
      >
        {pickByLocale(locale, { en: 'Status', sw: 'Hali' })}: {statusLabel}
        {lastPoll !== null
          ? pickByLocale(locale, {
              en: ` — last poll ${lastPoll}s ago`,
              sw: ` — kura ya mwisho sekunde ${lastPoll} zilizopita`,
            })
          : ''}
        {state.error
          ? `${pickByLocale(locale, { en: ' — error: ', sw: ' — hitilafu: ' })}${state.error}`
          : ''}
      </p>

      {!derived ? (
        state.status === 'error' ? (
          <div
            data-testid="system-health-error"
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            <span>
              <span className="font-medium">
                {pickByLocale(locale, {
                  en: 'Metrics endpoint unreachable.',
                  sw: 'Kituo cha vipimo hakipatikani.',
                })}
              </span>
              <span className="ml-1 text-muted-foreground">{state.error}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {pickByLocale(locale, {
                en: `Auto-retry in ${Math.round(POLL_INTERVAL_MS / 1000)} s.`,
                sw: `Jaribu tena kiotomatiki baada ya sekunde ${Math.round(POLL_INTERVAL_MS / 1000)}.`,
              })}
            </span>
          </div>
        ) : (
          <div
            data-testid="system-health-empty"
            role="status"
            aria-live="polite"
            aria-label={pickByLocale(locale, {
              en: 'Loading system health metrics',
              sw: 'Inapakia vipimo vya afya ya mfumo',
            })}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border border-border bg-surface-raised"
              />
            ))}
          </div>
        )
      ) : (
        <>
          <section
            data-testid="system-health-primary-cards"
            className="flex flex-wrap gap-3"
          >
            <MetricCard
              title={pickByLocale(locale, { en: 'Uptime', sw: 'Muda hai' })}
              value={pickByLocale(locale, {
                en: `${derived.uptimeMinutes} min`,
                sw: `dakika ${derived.uptimeMinutes}`,
              })}
              sub={pickByLocale(locale, {
                en: 'Process uptime',
                sw: 'Muda hai wa mchakato',
              })}
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: 'Events / sec',
                sw: 'Matukio / sekunde',
              })}
              value={derived.eventsPerSecond.toFixed(2)}
              sub={pickByLocale(locale, {
                en: `${derived.streamEvents} total stream events`,
                sw: `jumla ya matukio ya mtiririko ${derived.streamEvents}`,
              })}
            />
            <MetricCard
              title={pickByLocale(locale, { en: 'Latency', sw: 'Ucheleweshaji' })}
              value={formatMs(derived.latencyHist?.p50 ?? null)}
              sub={`p95 ${formatMs(derived.latencyHist?.p95 ?? null)} / p99 ${formatMs(derived.latencyHist?.p99 ?? null)}`}
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: "Today's spend",
                sw: 'Matumizi ya leo',
              })}
              value={formatUsd(derived.costMicro)}
              sub={pickByLocale(locale, {
                en: `${derived.turns} turns / ${derived.errors} errors`,
                sw: `zamu ${derived.turns} / hitilafu ${derived.errors}`,
              })}
              tone={derived.errors > 0 ? 'warn' : 'ok'}
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: 'Active personas',
                sw: 'Wahusika hai',
              })}
              value={String(derived.activePersonas?.value ?? '—')}
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: 'Heartbeat',
                sw: 'Mapigo ya moyo',
              })}
              value={formatMs(derived.lastTickAgo?.value ?? null)}
              tone={
                (derived.lastTickAgo?.value ?? 0) > 30_000
                  ? 'bad'
                  : (derived.lastTickAgo?.value ?? 0) > 10_000
                    ? 'warn'
                    : 'ok'
              }
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: 'Junior asleep',
                sw: 'Wasaidizi waliolala',
              })}
              value={String(derived.sleepCount?.value ?? '—')}
            />
            <MetricCard
              title={pickByLocale(locale, {
                en: 'Bg success rate',
                sw: 'Kiwango cha mafanikio ya kazi za nyuma',
              })}
              value={
                derived.bgRate === null ? '—' : `${derived.bgRate.toFixed(1)}%`
              }
              sub={pickByLocale(locale, {
                en: `${derived.bgSuccess} ok / ${derived.bgFailure} failed`,
                sw: `${derived.bgSuccess} sawa / ${derived.bgFailure} zilizoshindwa`,
              })}
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
            <h2 className="mb-2 font-display text-foreground">
              {pickByLocale(locale, {
                en: 'Circuit breakers',
                sw: 'Vizuizi vya mzunguko',
              })}
            </h2>
            {derived.breakerGauges.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {pickByLocale(locale, {
                  en: 'No breaker gauges reported.',
                  sw: 'Hakuna vipimo vya vizuizi vilivyoripotiwa.',
                })}
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
                      {breakerStateLabel(g.value, locale)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <SnapshotPanel snapshot={state.snapshot} locale={locale} />
        </>
      )}
    </div>
  );
}

const STATUS_LABEL_EN: Readonly<Record<FetchState['status'], string>> =
  Object.freeze({
    idle: 'idle',
    loading: 'loading',
    ok: 'ok',
    error: 'error',
  });

const STATUS_LABEL_SW: Readonly<Record<FetchState['status'], string>> =
  Object.freeze({
    idle: 'tuli',
    loading: 'inapakia',
    ok: 'sawa',
    error: 'hitilafu',
  });

/**
 * Readable, DS-styled replacement for the raw `<pre>{JSON.stringify(…)}</pre>`
 * snapshot dump. Renders the collected-at / uptime summary as a definition
 * list, then a per-section count strip and a monospaced, scroll-bounded
 * breakdown — all on semantic tokens (no raw light-palette literals).
 */
function SnapshotPanel({
  snapshot,
  locale,
}: {
  readonly snapshot: MetricsSnapshot | null;
  readonly locale: Locale;
}): JSX.Element | null {
  if (!snapshot) return null;
  const summary: ReadonlyArray<readonly [string, string]> = [
    [
      pickByLocale(locale, { en: 'Collected at', sw: 'Imekusanywa saa' }),
      snapshot.collectedAt.replace('T', ' ').slice(0, 19),
    ],
    [
      pickByLocale(locale, { en: 'Uptime', sw: 'Muda hai' }),
      pickByLocale(locale, {
        en: `${Math.floor(snapshot.uptimeSeconds / 60)} min`,
        sw: `dakika ${Math.floor(snapshot.uptimeSeconds / 60)}`,
      }),
    ],
    [
      pickByLocale(locale, { en: 'Counters', sw: 'Vihesabu' }),
      String(snapshot.counters.length),
    ],
    [
      pickByLocale(locale, { en: 'Gauges', sw: 'Vipimo' }),
      String(snapshot.gauges.length),
    ],
    [
      pickByLocale(locale, { en: 'Histograms', sw: 'Histogramu' }),
      String(snapshot.histograms.length),
    ],
  ];
  return (
    <details className="text-xs text-neutral-400">
      <summary className="cursor-pointer text-muted-foreground">
        {pickByLocale(locale, { en: 'Raw snapshot', sw: 'Picha ghafi' })}
      </summary>
      <Card variant="outline" className="mt-2 p-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {summary.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-tiny uppercase tracking-wider text-neutral-500">
                {label}
              </dt>
              <dd className="font-mono text-sm text-foreground tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <pre
          data-testid="system-health-raw"
          className="mt-4 max-h-80 overflow-auto rounded-md border border-border bg-surface-sunken p-3 font-mono text-tiny leading-relaxed text-neutral-300"
        >
          {JSON.stringify(snapshot, null, 2)}
        </pre>
      </Card>
    </details>
  );
}
