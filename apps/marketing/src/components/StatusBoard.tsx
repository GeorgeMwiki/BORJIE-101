'use client';

/**
 * StatusBoard — client component that polls /api/v1/public/status and
 * renders the live system-status grid. Polled every 30 s.
 *
 * Designed to be embedded in the server-rendered /status page so SEO
 * still works (initial render shows an empty grid; the client takes
 * over and fills it in).
 */
import { useEffect, useState } from 'react';
import { getMessages, type Locale } from '@/lib/i18n';

type SimpleStatus = 'ok' | 'degraded' | 'outage' | 'unknown';

type ComponentName =
  | 'api-gateway'
  | 'database'
  | 'auth'
  | 'storage'
  | 'workers'
  | 'realtime';

interface HistoryDay {
  readonly date: string;
  readonly status: SimpleStatus;
}

interface ComponentSummary {
  readonly component: ComponentName;
  readonly current: SimpleStatus;
  readonly lastChangedAt: string | null;
  readonly history: ReadonlyArray<HistoryDay>;
  readonly uptimePct: number;
}

interface StatusResponse {
  readonly overall: SimpleStatus;
  readonly components: ReadonlyArray<ComponentSummary>;
  readonly generatedAt: string;
  readonly windowDays: number;
}

const STATUS_COLOR: Record<SimpleStatus, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  outage: 'bg-red-500',
  unknown: 'bg-neutral-700',
};

const STATUS_TEXT: Record<SimpleStatus, string> = {
  ok: 'text-emerald-400',
  degraded: 'text-amber-400',
  outage: 'text-red-400',
  unknown: 'text-neutral-400',
};

function getApiBase(): string {
  if (typeof process !== 'undefined') {
    const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (fromEnv && fromEnv.length > 0) return fromEnv;
  }
  return '';
}

async function fetchStatus(signal: AbortSignal): Promise<StatusResponse> {
  const base = getApiBase();
  const url = `${base}/api/v1/public/status`;
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`status request failed: ${res.status}`);
  }
  const body = (await res.json()) as { success?: boolean; data?: StatusResponse };
  if (!body.success || !body.data) {
    throw new Error('status response missing data');
  }
  return body.data;
}

const POLL_INTERVAL_MS = 30_000;

export function StatusBoard({
  locale,
}: {
  readonly locale: Locale;
}) {
  const copy = getMessages(locale).status;
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [tick]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!data && !error) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-neutral-400">
        {copy.loading}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-surface p-8 text-center text-sm">
        <p className="text-red-400">{copy.error}</p>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="mt-4 rounded-md border border-border px-4 py-2 text-xs uppercase tracking-widest text-foreground hover:border-signal-500/60"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <OverallBanner copy={copy} status={data.overall} />
      <ul className="space-y-3">
        {data.components.map((comp) => (
          <li
            key={comp.component}
            className="rounded-lg border border-border bg-surface p-5"
          >
            <ComponentRow comp={comp} copy={copy} />
          </li>
        ))}
      </ul>
      <p className="text-right text-[0.7rem] uppercase tracking-widest text-neutral-500">
        {copy.windowLabelPrefix}{data.windowDays}{copy.windowLabelSuffix}
      </p>
    </div>
  );
}

type StatusCopy = ReturnType<typeof getMessages>['status'];

function OverallBanner(props: {
  readonly copy: StatusCopy;
  readonly status: SimpleStatus;
}) {
  const dot = STATUS_COLOR[props.status];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4">
      <span
        aria-hidden
        className={`h-3 w-3 rounded-full ${dot} ${
          props.status === 'ok' ? 'animate-pulse' : ''
        }`}
      />
      <span className="font-display text-lg text-foreground">
        {props.copy.overall[props.status]}
      </span>
    </div>
  );
}

function ComponentRow(props: {
  readonly comp: ComponentSummary;
  readonly copy: StatusCopy;
}) {
  const c = props.comp;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-base font-medium text-foreground">
            {props.copy.componentLabel[c.component]}
          </p>
          <p className={`text-xs uppercase tracking-widest ${STATUS_TEXT[c.current]}`}>
            {props.copy.statusLabel[c.current]}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-foreground">
            {c.uptimePct.toFixed(2)}%
          </p>
          <p className="text-[0.65rem] uppercase tracking-widest text-neutral-500">
            {props.copy.uptimeLabel}
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-[2px]">
        {c.history.map((d) => (
          <span
            key={d.date}
            title={`${d.date} · ${props.copy.statusLabel[d.status]}`}
            className={`h-7 flex-1 rounded-sm ${STATUS_COLOR[d.status]} opacity-80 hover:opacity-100`}
          />
        ))}
      </div>
      {c.lastChangedAt && (
        <p className="mt-3 text-[0.65rem] uppercase tracking-widest text-neutral-500">
          {props.copy.lastChangeLabel}: {new Date(c.lastChangedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
