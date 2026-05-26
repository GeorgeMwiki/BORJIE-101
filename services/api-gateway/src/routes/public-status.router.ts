/**
 * Public status router — UNAUTHENTICATED.
 *
 * Mounted under `/api/v1/public/status`. Powers the marketing status
 * page. Reads the last 90 days of samples from `service_status_history`
 * (RLS disabled, public-readable). Falls back to deterministic
 * placeholder data when DATABASE_URL is unset so the marketing site
 * keeps rendering even in degraded dev environments.
 *
 * Response shape is intentionally narrow — the page only needs the
 * current rollup per component and a 90-day timeline of daily worst-status.
 */
import { Hono } from 'hono';

type ComponentName =
  | 'api-gateway'
  | 'database'
  | 'auth'
  | 'storage'
  | 'workers'
  | 'realtime';

const COMPONENTS: ReadonlyArray<ComponentName> = [
  'api-gateway',
  'database',
  'auth',
  'storage',
  'workers',
  'realtime',
];

type SimpleStatus = 'ok' | 'degraded' | 'outage' | 'unknown';

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

const WINDOW_DAYS = 90;

// In-process cache — 30 s TTL stops the public page from hammering
// the DB during a marketing push. Recomputed lazily on miss.
let cache: { value: StatusResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function worstOf(a: SimpleStatus, b: SimpleStatus): SimpleStatus {
  const order: Record<SimpleStatus, number> = {
    ok: 0,
    unknown: 1,
    degraded: 2,
    outage: 3,
  };
  return order[a] >= order[b] ? a : b;
}

function emptyHistory(): HistoryDay[] {
  const today = new Date();
  const out: HistoryDay[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    out.push({ date: dayKey(d), status: 'unknown' });
  }
  return out;
}

function placeholderResponse(): StatusResponse {
  const components = COMPONENTS.map<ComponentSummary>((component) => ({
    component,
    current: 'ok',
    lastChangedAt: null,
    history: emptyHistory().map((d) => ({ ...d, status: 'ok' })),
    uptimePct: 100,
  }));
  return {
    overall: 'ok',
    components,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
  };
}

interface StatusRow {
  readonly component: string;
  readonly status: string;
  readonly at: Date;
}

async function loadFromDb(databaseUrl: string): Promise<StatusResponse> {
  // Dynamic import so the route module loads even when `postgres` is
  // not installed in the build context (it is, but defensive).
  const { default: postgres } = (await import('postgres')) as {
    default: (
      url: string,
      opts?: { max?: number; prepare?: boolean }
    ) => unknown;
  };
  const sql = postgres(databaseUrl, { max: 1, prepare: false }) as unknown as {
    (
      template: TemplateStringsArray,
      ...values: ReadonlyArray<unknown>
    ): Promise<ReadonlyArray<StatusRow>>;
    end: (opts?: { timeout?: number }) => Promise<void>;
  };

  let rows: ReadonlyArray<StatusRow> = [];
  try {
    rows = await sql`
      SELECT component, status::text AS status, at
      FROM service_status_history
      WHERE at >= now() - (${WINDOW_DAYS} || ' days')::interval
      ORDER BY at ASC
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }

  return rollup(rows);
}

function rollup(rows: ReadonlyArray<StatusRow>): StatusResponse {
  const byComponent = new Map<ComponentName, StatusRow[]>();
  for (const c of COMPONENTS) byComponent.set(c, []);
  for (const r of rows) {
    if ((COMPONENTS as ReadonlyArray<string>).includes(r.component)) {
      const arr = byComponent.get(r.component as ComponentName);
      if (arr) arr.push(r);
    }
  }

  const components: ComponentSummary[] = COMPONENTS.map((component) => {
    const samples = byComponent.get(component) ?? [];
    const dayMap = new Map<string, SimpleStatus>();
    for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      dayMap.set(dayKey(d), 'unknown');
    }
    for (const s of samples) {
      const k = dayKey(new Date(s.at));
      const status = (s.status === 'degraded' || s.status === 'outage'
        ? s.status
        : 'ok') as SimpleStatus;
      const prev = dayMap.get(k) ?? 'unknown';
      dayMap.set(k, prev === 'unknown' ? status : worstOf(prev, status));
    }
    const history: HistoryDay[] = [...dayMap.entries()].map(([date, status]) => ({
      date,
      status,
    }));
    const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
    const current: SimpleStatus = last
      ? (last.status === 'degraded' || last.status === 'outage'
          ? last.status
          : 'ok')
      : 'unknown';
    const known = history.filter((d) => d.status !== 'unknown');
    const okCount = known.filter((d) => d.status === 'ok').length;
    const uptimePct = known.length === 0 ? 100 : (okCount / known.length) * 100;
    return {
      component,
      current,
      lastChangedAt: last ? new Date(last.at).toISOString() : null,
      history,
      uptimePct: Math.round(uptimePct * 100) / 100,
    };
  });

  const overall = components.reduce<SimpleStatus>(
    (acc, c) => worstOf(acc, c.current),
    'ok'
  );

  return {
    overall,
    components,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
  };
}

const app = new Hono();

app.get('/', async (c) => {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return c.json({ success: true, data: cache.value });
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  let payload: StatusResponse;
  if (!databaseUrl) {
    payload = placeholderResponse();
  } else {
    try {
      payload = await loadFromDb(databaseUrl);
    } catch {
      // On DB failure, surface a degraded "database" component so the
      // page still tells the truth, without erroring the route.
      payload = placeholderResponse();
      payload = {
        ...payload,
        overall: 'degraded',
        components: payload.components.map((comp) =>
          comp.component === 'database'
            ? { ...comp, current: 'degraded', uptimePct: 0 }
            : comp
        ),
      };
    }
  }

  cache = { value: payload, expiresAt: now + CACHE_TTL_MS };
  return c.json({ success: true, data: payload });
});

export default app;
export { COMPONENTS as PUBLIC_STATUS_COMPONENTS };
export type { StatusResponse, ComponentSummary, SimpleStatus, ComponentName };
