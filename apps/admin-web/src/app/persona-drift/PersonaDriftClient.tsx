'use client';

/**
 * PersonaDriftClient — admin dashboard renderer (Phase D D7).
 *
 * Fetches `/api/v1/persona-drift/events` (DB scan of
 * `kernel_persona_drift_events`) every 60 s and renders:
 *
 *   - a table of the most recent breaches (timestamp, persona,
 *     severity, worst-dim, excerpt)
 *   - a bar chart of dim-breach counts over the last N days
 *
 * Production binds the endpoint to a router that paginates the table.
 * In the absence of a wired endpoint the client shows a friendly
 * "Awaiting first breach" empty state.
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Purely client surface — the hook falls back to
 * the project default and the post-mount effect corrects it.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Empty,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  type BadgeProps,
} from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';

interface DriftEvent {
  readonly id: string;
  readonly personaId: string;
  readonly violationType: string;
  readonly excerpt: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly detectedAt: string;
  readonly worstDim?: string;
}

interface FetchState {
  readonly status: 'idle' | 'loading' | 'ok' | 'error';
  readonly events: ReadonlyArray<DriftEvent>;
  readonly error: string | null;
  readonly fetchedAt: number | null;
}

const POLL_INTERVAL_MS = 60_000;

const S = {
  loadFailed: {
    en: 'Could not load persona-drift events.',
    sw: 'Imeshindwa kupakia matukio ya kupotoka kwa persona.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  loadingLabel: {
    en: 'Loading persona-drift events',
    sw: 'Inapakia matukio ya kupotoka kwa persona',
  },
  emptyTitle: { en: 'Awaiting first breach', sw: 'Inasubiri ukiukaji wa kwanza' },
  emptyBody: {
    en: 'The persona-drift cron emits one event per (tenant, persona, day) when the 24-dim probe exceeds threshold.',
    sw: 'Cron ya kupotoka kwa persona hutoa tukio moja kwa kila (mteja, persona, siku) wakati kipimo cha vipimo-24 kinapozidi kizingiti.',
  },
  breachByDay: { en: 'Breach counts by day', sw: 'Idadi ya ukiukaji kwa siku' },
  recentBreaches: { en: 'Recent breaches', sw: 'Ukiukaji wa hivi karibuni' },
  colWhen: { en: 'When', sw: 'Lini' },
  colPersona: { en: 'Persona', sw: 'Persona' },
  colSeverity: { en: 'Severity', sw: 'Ukali' },
  colWorstDim: { en: 'Worst dim', sw: 'Kipimo dhaifu' },
  colExcerpt: { en: 'Excerpt', sw: 'Dondoo' },
} as const;

const SEVERITY_VARIANT: Record<DriftEvent['severity'], BadgeProps['variant']> = {
  high: 'error-soft',
  medium: 'warning-soft',
  low: 'secondary',
};

function endpoint(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  const trimmed = base ? base.replace(/\/$/, '') : '';
  return `${trimmed}/api/v1/persona-drift/events`;
}

export function PersonaDriftClient() {
  const locale = useLocale();
  const [state, setState] = useState<FetchState>({
    status: 'idle',
    events: [],
    error: null,
    fetchedAt: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchEvents() {
      try {
        setState((s) => ({ ...s, status: 'loading' }));
        const res = await fetch(endpoint(), { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { data?: ReadonlyArray<DriftEvent> };
        if (cancelled) return;
        setState({
          status: 'ok',
          events: data.data ?? [],
          error: null,
          fetchedAt: Date.now(),
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    void fetchEvents();
    const id = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [reloadKey]);

  const chartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of state.events) {
      const day = e.detectedAt.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ day, count }));
  }, [state.events]);

  if (state.status === 'error') {
    return (
      <Alert
        variant="error"
        title={pickByLocale(locale, S.loadFailed)}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {pickByLocale(locale, S.retry)}
          </Button>
        }
      >
        {state.error}
      </Alert>
    );
  }

  if (state.status === 'loading' && state.events.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={pickByLocale(locale, S.loadingLabel)}
        className="flex flex-col gap-6"
      >
        <section>
          <Skeleton className="mb-2 h-4 w-44 rounded" />
          <Skeleton className="h-32 rounded-md border border-border" />
        </section>
        <section>
          <Skeleton className="mb-2 h-4 w-32 rounded" />
          <Skeleton className="h-40 rounded-md border border-border" />
        </section>
      </div>
    );
  }

  if (state.status === 'ok' && state.events.length === 0) {
    return (
      <Empty
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          {pickByLocale(locale, S.breachByDay)}
        </h2>
        <div className="flex h-32 items-end gap-2 rounded-md border border-border bg-surface-sunken p-3">
          {chartData.map((bar) => {
            const maxCount = Math.max(...chartData.map((d) => d.count), 1);
            const heightPct = (bar.count / maxCount) * 100;
            return (
              <div
                key={bar.day}
                className="flex flex-col items-center gap-1"
                title={`${bar.day}: ${bar.count}`}
              >
                <div
                  className="w-6 rounded-t-sm bg-info"
                  style={{ height: `${heightPct}%` }}
                />
                <span className="text-tiny text-muted-foreground">
                  {bar.day.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          {pickByLocale(locale, S.recentBreaches)}
        </h2>
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colWhen)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colPersona)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colSeverity)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colWorstDim)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colExcerpt)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.events.slice(0, 50).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground">
                    {e.detectedAt}
                  </TableCell>
                  <TableCell className="text-foreground">{e.personaId}</TableCell>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[e.severity]} size="sm">
                      {e.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.worstDim ?? '—'}
                  </TableCell>
                  <TableCell className="text-foreground">{e.excerpt}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>
    </div>
  );
}
