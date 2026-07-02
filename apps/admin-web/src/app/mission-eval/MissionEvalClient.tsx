'use client';

/**
 * Mission-eval interactive client — Wave-K portal-parity.
 *
 * Calls:
 *   GET  /api/v1/parity/capability/dashboard         — rollup tile
 *   GET  /api/v1/parity/capability/dashboard/runs    — filtered list
 *   GET  /api/v1/parity/capability/dashboard/runs/:id — drill
 *   POST /api/v1/parity/capability/dashboard/runs/:id/judge — re-judge
 *
 * Filters: capability, score range, scenario category. Click a row to
 * open a DS Drawer (focus-trapped, ESC-dismissible) with captured CoT
 * (PII-scrubbed) + judge score + reason + a "re-judge" button.
 *
 * Rendered on design-system primitives + semantic tokens so the screen
 * lives correctly inside the dark admin shell. SINGLE LANGUAGE PER LOCALE
 * (canon): every user-facing string resolves to the active locale via
 * `pickByLocale`. Purely client surface — the hook falls back to the
 * project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, AlertTriangle, RefreshCcw } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Badge,
  FormField,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Empty,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  type BadgeProps,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { formatDateTime } from '@/lib/format';

// NOTE: `id` values are the wire contract consumed by the gateway's
// parity-capability-dashboard factory (services/api-gateway/src/routes/
// parity-capability-dashboard.router.ts CAPABILITIES array). They are NOT
// user-visible — only `label` is rendered — so ids must match the gateway
// enum verbatim. `offtake-renewal` is the mining-domain id for licence
// renewal; the label surfaces the mining-coherent wording to operators.
const CAPABILITIES = [
  {
    id: 'rent-reconciliation',
    label: { en: 'Royalty reconciliation', sw: 'Upatanishi wa mrabaha' },
  },
  {
    id: 'offtake-renewal',
    label: { en: 'Licence renewal', sw: 'Uhuishaji wa leseni' },
  },
  { id: 'kra-mri', label: { en: 'TRA royalty return', sw: 'Marejesho ya mrabaha ya TRA' } },
  { id: 'gepg', label: { en: 'GePG', sw: 'GePG' } },
  {
    id: 'maintenance-triage',
    label: { en: 'Maintenance triage', sw: 'Upangaji wa matengenezo' },
  },
  { id: 'voice-agent', label: { en: 'Voice agent', sw: 'Wakala wa sauti' } },
] as const;

type CapabilityId = (typeof CAPABILITIES)[number]['id'];

interface CapabilityTile {
  readonly id: string;
  readonly runsLast24h: number;
  readonly meanJudgeScore: number | null;
  readonly regenRateLast24h: number | null;
}

interface DashboardRollup {
  readonly capabilities: ReadonlyArray<CapabilityTile>;
  readonly totals: { provenanceCount: number; cotSampleCount: number };
  readonly generatedAt: string;
  readonly degraded?: boolean;
}

interface EvalRunRow {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly judgeScore: number | null;
  readonly category: string | null;
  readonly capability: string | null;
  readonly producedAt: string;
}

interface EvalRunDetail extends EvalRunRow {
  readonly cotThoughtText: string | null;
  readonly judgeReasonText?: string | null;
  readonly judgeSuggestedFix?: string | null;
  readonly promptHash?: string | null;
  readonly responseHash?: string | null;
  readonly modelId?: string;
  readonly sensorId?: string;
}

// Row shape returned by GET /api/v1/admin/cot-query/query — the dedicated
// regulator-facing CoT reservoir surface (PII-scrubbed, hash-anchored). The
// parity dashboard's own drill endpoint does NOT carry the captured CoT for
// this view, so the drawer fetches it from this endpoint and matches by
// `thoughtId`. See services/api-gateway/src/routes/cot-query.router.ts.
interface CotReservoirRow {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly thoughtText: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly capturedAt: string;
}

// The CoT reservoir query is keyed by tenant + time window (not a single
// thoughtId), so we bracket the selected run's `producedAt` and match the
// row out of the returned window. A generous ±10 minute window absorbs clock
// skew between the provenance row and the reservoir capture.
const COT_WINDOW_MS = 10 * 60 * 1000;

const S = {
  loadRollupFailed: {
    en: 'Failed to load capability rollup',
    sw: 'Imeshindwa kupakia muhtasari wa uwezo',
  },
  loadRunsFailed: {
    en: 'Failed to load eval runs',
    sw: 'Imeshindwa kupakia tathmini',
  },
  rejudgeFailed: { en: 'Re-judge failed', sw: 'Tathmini upya imeshindwa' },
  rollupLabel: { en: 'Capability rollup', sw: 'Muhtasari wa uwezo' },
  runs24h: { en: 'Runs (24h)', sw: 'Mizunguko (saa 24)' },
  meanJudge: { en: 'Mean judge', sw: 'Wastani wa jaji' },
  regenRate: { en: 'Regen rate', sw: 'Kiwango cha kuzalisha upya' },
  degraded: {
    en: 'Degraded view — substrate service is not wired in this environment.',
    sw: 'Mwonekano uliopunguzwa — huduma ya msingi haijaunganishwa katika mazingira haya.',
  },
  filters: { en: 'Filters', sw: 'Vichujio' },
  capability: { en: 'Capability', sw: 'Uwezo' },
  all: { en: 'All', sw: 'Zote' },
  minScore: { en: 'Min score', sw: 'Alama ya chini' },
  maxScore: { en: 'Max score', sw: 'Alama ya juu' },
  category: { en: 'Scenario category', sw: 'Aina ya hali' },
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },
  evalRuns: { en: 'Eval runs', sw: 'Mizunguko ya tathmini' },
  emptyTitle: {
    en: 'No eval runs match these filters',
    sw: 'Hakuna tathmini inayolingana na vichujio hivi',
  },
  emptyBody: {
    en: 'Widen the score range or clear the category to see more runs.',
    sw: 'Panua kiwango cha alama au futa aina ili kuona mizunguko zaidi.',
  },
  colThought: { en: 'Thought', sw: 'Wazo' },
  colStakes: { en: 'Stakes', sw: 'Hatari' },
  colCategory: { en: 'Category', sw: 'Aina' },
  colJudge: { en: 'Judge', sw: 'Jaji' },
  colWhen: { en: 'When', sw: 'Lini' },
  showing: { en: 'Showing', sw: 'Inaonyesha' },
  of: { en: 'of', sw: 'kati ya' },
  runsNarrow: {
    en: 'runs (refine filters to narrow).',
    sw: 'mizunguko (boresha vichujio kupunguza).',
  },
  capturedRun: { en: 'Captured eval run', sw: 'Tathmini iliyonaswa' },
  judgeScore: { en: 'Judge score', sw: 'Alama ya jaji' },
  judgeReason: { en: 'Judge reason', sw: 'Sababu ya jaji' },
  suggestedFix: { en: 'Suggested fix', sw: 'Marekebisho yaliyopendekezwa' },
  capturedCot: {
    en: 'Captured chain-of-thought (PII-scrubbed)',
    sw: 'Mlolongo wa mawazo uliokamatwa (umesafishwa PII)',
  },
  loadingCot: {
    en: 'Loading captured chain-of-thought…',
    sw: 'Inapakia mlolongo wa mawazo…',
  },
  notCaptured: {
    en: '— (not captured at sampling)',
    sw: '— (haukunaswa wakati wa sampuli)',
  },
  model: { en: 'Model', sw: 'Modeli' },
  promptHash: { en: 'Prompt hash', sw: 'Heshi ya ombi' },
  responseHash: { en: 'Response hash', sw: 'Heshi ya jibu' },
  rejudge: {
    en: 'Re-judge with current rubric',
    sw: 'Tathmini upya kwa kigezo cha sasa',
  },
} as const;

// Closed-enum stakes mapped to per-locale labels. The wire carries the
// stable token (`low`/`medium`/`high`/`critical`); the FE localizes at
// render so the cell never shows a foreign-language word.
const STAKES_LABEL: Record<
  'low' | 'medium' | 'high' | 'critical',
  { en: string; sw: string }
> = {
  low: { en: 'low', sw: 'chini' },
  medium: { en: 'medium', sw: 'wastani' },
  high: { en: 'high', sw: 'juu' },
  critical: { en: 'critical', sw: 'muhimu sana' },
};

function cotQueryPath(producedAt: string): string {
  const center = Date.parse(producedAt);
  const params = new URLSearchParams();
  if (Number.isFinite(center)) {
    params.set('since', new Date(center - COT_WINDOW_MS).toISOString());
    params.set('until', new Date(center + COT_WINDOW_MS).toISOString());
  }
  // Sovereign raw access — the mission-eval console is staff-only and the
  // session carries the `cot:read:raw` scope; the gateway re-scrubs on read.
  params.set('include_raw', 'true');
  params.set('limit', '200');
  return `/admin/cot-query/query?${params.toString()}`;
}

/** Score → DS badge tone, on semantic tokens (no raw rose/amber/emerald). */
function scoreVariant(score: number | null): BadgeProps['variant'] {
  if (score === null) return 'secondary';
  if (score < 0.5) return 'error-soft';
  if (score < 0.8) return 'warning-soft';
  return 'success-soft';
}

export function MissionEvalClient({ initialLocale }: { readonly initialLocale?: Locale } = {}) {
  const locale = useLocale(initialLocale);
  const [rollup, setRollup] = useState<DashboardRollup | null>(null);
  const [rows, setRows] = useState<ReadonlyArray<EvalRunRow>>([]);
  const [total, setTotal] = useState<number>(0);
  const [loadingRollup, setLoadingRollup] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<CapabilityId | ''>('');
  const [minScore, setMinScore] = useState<string>('');
  const [maxScore, setMaxScore] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [selected, setSelected] = useState<EvalRunDetail | null>(null);
  const [rejudging, setRejudging] = useState(false);
  const [cotLoading, setCotLoading] = useState(false);

  const loadRollup = useCallback(async () => {
    setLoadingRollup(true);
    setError(null);
    const res = await api.get<DashboardRollup>('/parity/capability/dashboard');
    if (res.success && res.data) {
      setRollup(res.data);
    } else {
      setError(res.error ?? pickByLocale(locale, S.loadRollupFailed));
    }
    setLoadingRollup(false);
  }, [locale]);

  const loadRuns = useCallback(async () => {
    setLoadingRows(true);
    setError(null);
    const params = new URLSearchParams();
    if (capability) params.set('capability', capability);
    if (minScore) params.set('minScore', minScore);
    if (maxScore) params.set('maxScore', maxScore);
    if (category) params.set('category', category);
    params.set('limit', '50');
    const path = `/parity/capability/dashboard/runs?${params.toString()}`;
    const res = await api.get<ReadonlyArray<EvalRunRow>>(path);
    if (res.success && res.data) {
      setRows(res.data);
      const meta = (res as unknown as { meta?: { total?: number } }).meta;
      setTotal(meta?.total ?? res.data.length);
    } else {
      setError(res.error ?? pickByLocale(locale, S.loadRunsFailed));
      setRows([]);
      setTotal(0);
    }
    setLoadingRows(false);
  }, [capability, minScore, maxScore, category, locale]);

  useEffect(() => {
    void loadRollup();
  }, [loadRollup]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function openDetail(row: EvalRunRow): Promise<void> {
    setSelected({ ...row, cotThoughtText: null });
    setCotLoading(true);
    // Load the parity drill (judge reason/fix, hashes, model) and the
    // captured chain-of-thought (from the dedicated reservoir endpoint) in
    // parallel. The CoT lives on a separate, sovereign-scoped surface, so the
    // drawer stitches the two together.
    const [detailRes, cotText] = await Promise.all([
      api.get<EvalRunDetail>(
        `/parity/capability/dashboard/runs/${encodeURIComponent(row.thoughtId)}`,
      ),
      fetchCotText(row),
    ]);
    setCotLoading(false);
    // Guard against a stale resolution: only apply if this row is still the
    // selected one (the operator may have clicked another row meanwhile).
    setSelected((current) => {
      if (!current || current.thoughtId !== row.thoughtId) return current;
      const base: EvalRunDetail =
        detailRes.success && detailRes.data ? detailRes.data : current;
      return { ...base, cotThoughtText: cotText ?? base.cotThoughtText ?? null };
    });
  }

  async function fetchCotText(row: EvalRunRow): Promise<string | null> {
    const res = await api.get<ReadonlyArray<CotReservoirRow>>(
      cotQueryPath(row.producedAt),
    );
    if (!res.success || !res.data) return null;
    const match = res.data.find((r) => r.thoughtId === row.thoughtId);
    return match?.thoughtText ?? null;
  }

  async function rejudge(thoughtId: string): Promise<void> {
    setRejudging(true);
    const res = await api.post<EvalRunDetail>(
      `/parity/capability/dashboard/runs/${encodeURIComponent(thoughtId)}/judge`,
      {},
    );
    setRejudging(false);
    if (res.success && res.data) {
      setSelected(res.data);
      setRows((prev) =>
        prev.map((r) =>
          r.thoughtId === thoughtId
            ? { ...r, judgeScore: res.data!.judgeScore }
            : r,
        ),
      );
    } else {
      setError(res.error ?? pickByLocale(locale, S.rejudgeFailed));
    }
  }

  const filterControlsDisabled = useMemo(
    () => loadingRollup && rows.length === 0,
    [loadingRollup, rows.length],
  );

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="error">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            {error}
          </span>
        </Alert>
      )}

      {/* Capability rollup tiles */}
      <section
        aria-label={pickByLocale(locale, S.rollupLabel)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {loadingRollup &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl border border-border" />
          ))}
        {!loadingRollup &&
          rollup?.capabilities.map((tile) => (
            <Card
              key={tile.id}
              data-testid={`capability-tile-${tile.id}`}
              className="flex flex-col gap-2 rounded-2xl p-6 transition-colors hover:border-border-strong"
            >
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {(() => {
                    const cap = CAPABILITIES.find((c) => c.id === tile.id);
                    return cap ? pickByLocale(locale, cap.label) : tile.id;
                  })()}
                </h3>
                <ShieldCheck className="h-4 w-4 text-info" />
              </header>
              <dl className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                <div>
                  <dt>{pickByLocale(locale, S.runs24h)}</dt>
                  <dd className="font-mono text-base text-foreground">
                    {tile.runsLast24h}
                  </dd>
                </div>
                <div>
                  <dt>{pickByLocale(locale, S.meanJudge)}</dt>
                  <dd className="font-mono text-base text-foreground">
                    {tile.meanJudgeScore === null
                      ? '—'
                      : tile.meanJudgeScore.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>{pickByLocale(locale, S.regenRate)}</dt>
                  <dd className="font-mono text-base text-foreground">
                    {tile.regenRateLast24h === null
                      ? '—'
                      : `${(tile.regenRateLast24h * 100).toFixed(1)}%`}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        {rollup?.degraded && (
          <Card className="col-span-full rounded-2xl p-6 text-xs text-muted-foreground transition-colors hover:border-border-strong">
            {pickByLocale(locale, S.degraded)}
          </Card>
        )}
      </section>

      {/* Filters */}
      <Card
        aria-label={pickByLocale(locale, S.filters)}
        className="flex flex-wrap items-end gap-3 rounded-2xl p-6 transition-colors hover:border-border-strong"
      >
        <FormField
          label={pickByLocale(locale, S.capability)}
          name="capability"
          className="min-w-[12rem]"
        >
          <select
            data-testid="filter-capability"
            value={capability}
            onChange={(e) => setCapability(e.target.value as CapabilityId | '')}
            disabled={filterControlsDisabled}
            aria-label={pickByLocale(locale, S.capability)}
            className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{pickByLocale(locale, S.all)}</option>
            {CAPABILITIES.map((c) => (
              <option key={c.id} value={c.id}>
                {pickByLocale(locale, c.label)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label={pickByLocale(locale, S.minScore)}
          name="minScore"
          className="w-28"
        >
          <Input
            data-testid="filter-min-score"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
        </FormField>
        <FormField
          label={pickByLocale(locale, S.maxScore)}
          name="maxScore"
          className="w-28"
        >
          <Input
            data-testid="filter-max-score"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
          />
        </FormField>
        <FormField
          label={pickByLocale(locale, S.category)}
          name="category"
          className="w-48"
        >
          <Input
            data-testid="filter-category"
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="refusal, drift, policy…"
          />
        </FormField>
        <Button
          type="button"
          onClick={() => void loadRuns()}
          disabled={loadingRows}
          size="sm"
          leftIcon={<RefreshCcw className="h-4 w-4" />}
        >
          {pickByLocale(locale, S.refresh)}
        </Button>
      </Card>

      {/* Runs table */}
      <Card
        aria-label={pickByLocale(locale, S.evalRuns)}
        className="overflow-hidden rounded-2xl p-6 transition-colors hover:border-border-strong"
        data-testid="eval-runs-table"
      >
        {loadingRows && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        )}
        {!loadingRows && rows.length === 0 && !error && (
          <Empty
            title={pickByLocale(locale, S.emptyTitle)}
            description={pickByLocale(locale, S.emptyBody)}
          />
        )}
        {!loadingRows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colThought)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colStakes)}</TableHead>
                <TableHead>{pickByLocale(locale, S.capability)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colCategory)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colJudge)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colWhen)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.thoughtId}
                  data-testid={`eval-row-${r.thoughtId}`}
                  onClick={() => void openDetail(r)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void openDetail(r);
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.thoughtId.slice(0, 12)}…
                  </TableCell>
                  <TableCell className="text-xs">
                    {pickByLocale(locale, STAKES_LABEL[r.stakes])}
                  </TableCell>
                  <TableCell className="text-xs">{r.capability ?? '—'}</TableCell>
                  <TableCell className="text-xs">{r.category ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={scoreVariant(r.judgeScore)} size="sm">
                      {r.judgeScore === null ? '—' : r.judgeScore.toFixed(2)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(r.producedAt, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > rows.length && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {pickByLocale(locale, S.showing)} {rows.length}{' '}
            {pickByLocale(locale, S.of)} {total}{' '}
            {pickByLocale(locale, S.runsNarrow)}
          </p>
        )}
      </Card>

      {/* Detail drawer — DS Drawer (focus trap + ESC for free) */}
      <Drawer
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DrawerContent side="right" size="lg" data-testid="detail-drawer">
          {selected && (
            <>
              <DrawerHeader>
                <DrawerTitle>{pickByLocale(locale, S.capturedRun)}</DrawerTitle>
                <p className="font-mono text-xs text-muted-foreground">
                  {selected.thoughtId}
                </p>
              </DrawerHeader>
              <DrawerBody>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {pickByLocale(locale, S.judgeScore)}
                    </dt>
                    <dd className="font-mono text-base text-foreground">
                      <Badge variant={scoreVariant(selected.judgeScore)}>
                        {selected.judgeScore === null
                          ? '—'
                          : selected.judgeScore.toFixed(2)}
                      </Badge>
                    </dd>
                  </div>
                  {selected.judgeReasonText && (
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {pickByLocale(locale, S.judgeReason)}
                      </dt>
                      <dd className="text-sm text-foreground">
                        {selected.judgeReasonText}
                      </dd>
                    </div>
                  )}
                  {selected.judgeSuggestedFix && (
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        {pickByLocale(locale, S.suggestedFix)}
                      </dt>
                      <dd className="text-sm text-foreground">
                        {selected.judgeSuggestedFix}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {pickByLocale(locale, S.capturedCot)}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap rounded bg-surface-sunken p-3 font-mono text-xs text-foreground">
                      {cotLoading && selected.cotThoughtText === null ? (
                        <span className="text-muted-foreground">
                          {pickByLocale(locale, S.loadingCot)}
                        </span>
                      ) : (
                        (selected.cotThoughtText ??
                          pickByLocale(locale, S.notCaptured))
                      )}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <dt>{pickByLocale(locale, S.colStakes)}</dt>
                      <dd className="text-foreground">
                        {pickByLocale(locale, STAKES_LABEL[selected.stakes])}
                      </dd>
                    </div>
                    <div>
                      <dt>{pickByLocale(locale, S.model)}</dt>
                      <dd className="text-foreground">
                        {selected.modelId ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>{pickByLocale(locale, S.promptHash)}</dt>
                      <dd className="break-all font-mono text-tiny">
                        {selected.promptHash ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt>{pickByLocale(locale, S.responseHash)}</dt>
                      <dd className="break-all font-mono text-tiny">
                        {selected.responseHash ?? '—'}
                      </dd>
                    </div>
                  </div>
                </dl>
                <Button
                  type="button"
                  onClick={() => void rejudge(selected.thoughtId)}
                  loading={rejudging}
                  fullWidth
                  data-testid="rejudge-button"
                  className="mt-6"
                >
                  {pickByLocale(locale, S.rejudge)}
                </Button>
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
