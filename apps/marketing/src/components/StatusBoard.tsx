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
import { requirePublicBaseUrl } from '@/lib/env-guard';

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

// Status dots/text resolve to the design-system SEMANTIC tokens
// (muted emerald success · copper-family warning · burnt-red danger),
// not raw Tailwind palette colours, so the board reads institutional
// and tracks light/dark. Hue is always paired with a text label, never
// the sole signal.
const STATUS_COLOR: Record<SimpleStatus, string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  outage: 'bg-danger',
  unknown: 'bg-neutral-400',
};

const STATUS_TEXT: Record<SimpleStatus, string> = {
  ok: 'text-success',
  degraded: 'text-warning',
  outage: 'text-danger',
  unknown: 'text-foreground/70',
};

/**
 * Resolve the api-gateway origin the status grid polls. We refuse the
 * silent same-origin '' fallback: an unset var same-origins the fetch
 * to the marketing host, which has no /api/v1/public/status route, so
 * the card would degrade to a permanent error. `requirePublicBaseUrl`
 * throws loud in production (forcing the deployer to set the var) and
 * only uses the localhost dev fallback under `next dev` — same pattern
 * as Nav/Footer/sitemap.
 */
function getApiBase(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_BASE_URL',
    'http://127.0.0.1:4001',
  ).replace(/\/$/, '');
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

/**
 * Resolve the Intl BCP-47 tag for the active marketing locale
 * (locale-follows-the-user). A bare `toLocaleString()` renders the
 * timestamp with the visitor's HOST default — an English-by-omission
 * format under the `sw` surface (the zero-mix canon forbids that). The
 * `en` tag is `en-GB`, matching the app-wide canon (owner-web
 * `lib/format.ts`, workforce `home/owner/format.ts`, buyer `lib/locale.ts`
 * all resolve `en → en-GB`); `sw → sw-TZ` reads in the operator
 * jurisdiction.
 */
const BCP47_FOR_LOCALE: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'en-GB',
  sw: 'sw-TZ',
});

export function StatusBoard({
  locale,
}: {
  readonly locale: Locale;
}) {
  const copy = getMessages(locale).status;
  const bcp47 = BCP47_FOR_LOCALE[locale];
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
      <div
        role="status"
        aria-live="polite"
        aria-label={copy.loading}
        className="space-y-3"
      >
        <div className="h-12 animate-pulse rounded-lg border border-border bg-surface" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-surface p-8 text-center text-sm"
      >
        <p className="text-destructive">{copy.error}</p>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="mt-4 rounded-md border border-border px-4 py-2 text-xs uppercase tracking-widest text-foreground transition-colors hover:border-signal-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
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
            <ComponentRow comp={comp} copy={copy} bcp47={bcp47} />
          </li>
        ))}
      </ul>
      <p className="text-right text-pill uppercase tracking-widest text-foreground/60">
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
  readonly bcp47: string;
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
          <p className="text-caption-lg uppercase tracking-widest text-foreground/60">
            {props.copy.uptimeLabel}
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-hairline">
        {c.history.map((d) => (
          <span
            key={d.date}
            title={`${d.date} · ${props.copy.statusLabel[d.status]}`}
            className={`h-7 flex-1 rounded-sm ${STATUS_COLOR[d.status]} opacity-80 hover:opacity-100`}
          />
        ))}
      </div>
      {c.lastChangedAt && (
        <p className="mt-3 text-caption-lg uppercase tracking-widest text-foreground/60">
          {props.copy.lastChangeLabel}: {new Date(c.lastChangedAt).toLocaleString(props.bcp47)}
        </p>
      )}
    </div>
  );
}
