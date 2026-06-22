'use client';

/**
 * Mission-eval scenario drill-down client — Phase D / D12.11.
 *
 * Fetches:
 *   GET  /api/v1/parity/capability/dashboard/scenarios/:scenarioId/samples
 *
 * Renders a DS table of CoT samples for the chosen scenario id, plus a DS
 * Drawer (focus-trap + ESC) with the full CoT text + judge verdict + 5-C
 * rubric breakdown.
 *
 * Rendered on design-system primitives + semantic tokens so the screen
 * lives correctly inside the dark admin shell (the previous build was a
 * full neutral/rose/emerald light leaf). SINGLE LANGUAGE PER LOCALE
 * (canon): every user-facing string resolves to the active locale via
 * `pickByLocale`. Purely client surface — the hook falls back to the
 * project default and the post-mount effect corrects it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Badge,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  type BadgeProps,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale } from '@/lib/locale';

export interface MissionEvalScenarioDrillDownProps {
  readonly scenarioId: string;
}

interface CotSample {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly capturedAt: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly judgeScore: number | null;
  readonly judgeReasonText: string | null;
  readonly judgeSuggestedFix: string | null;
  readonly cotThoughtText: string | null;
  readonly modelId: string | null;
  readonly sensorId: string | null;
  readonly rubric?: {
    readonly completeness: number;
    readonly correctness: number;
    readonly citations: number;
    readonly consistency: number;
    readonly candor: number;
  };
  readonly weakestAxis?: string;
}

interface SamplesResponse {
  readonly scenarioId: string;
  readonly samples: ReadonlyArray<CotSample>;
  readonly total: number;
  readonly generatedAt: string;
}

const S = {
  loadFailed: { en: 'Failed to load samples', sw: 'Imeshindwa kupakia sampuli' },
  samplesCaptured: { en: 'samples captured', sw: 'sampuli zilizonaswa' },
  sampleCaptured: { en: 'sample captured', sw: 'sampuli iliyonaswa' },
  total: { en: 'total', sw: 'jumla' },
  intro: {
    en: 'Click any row to inspect the full CoT, judge verdict, and 5-C rubric breakdown.',
    sw: 'Bofya safu yoyote kukagua CoT kamili, uamuzi wa jaji, na uchanganuzi wa kigezo cha 5-C.',
  },
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },
  emptyTitle: {
    en: 'No CoT samples captured yet',
    sw: 'Hakuna sampuli za CoT zilizonaswa bado',
  },
  emptyBody: {
    en: 'Samples for this scenario will appear here once the brain runs it.',
    sw: 'Sampuli za hali hii zitaonekana hapa mara ubongo utakapoiendesha.',
  },
  colCaptured: { en: 'Captured', sw: 'Imenaswa' },
  colStakes: { en: 'Stakes', sw: 'Hatari' },
  colJudge: { en: 'Judge score', sw: 'Alama ya jaji' },
  colWeakest: { en: 'Weakest axis', sw: 'Mhimili dhaifu' },
  colModel: { en: 'Model', sw: 'Modeli' },
  thought: { en: 'Thought', sw: 'Wazo' },
  thread: { en: 'Thread', sw: 'Mnyororo' },
  sensor: { en: 'Sensor', sw: 'Kihisi' },
  judgeReason: { en: 'Judge reason', sw: 'Sababu ya jaji' },
  suggestedFix: { en: 'Suggested fix', sw: 'Marekebisho yaliyopendekezwa' },
  rubric5c: { en: '5-C rubric', sw: 'Kigezo cha 5-C' },
  cotThought: {
    en: 'CoT thought (PII-scrubbed)',
    sw: 'Wazo la CoT (limesafishwa PII)',
  },
  noCot: { en: '— no CoT captured —', sw: '— hakuna CoT iliyonaswa —' },
  na: { en: 'n/a', sw: 'haipo' },
} as const;

/** Score → DS badge tone, on semantic tokens (no raw rose/amber/emerald). */
function scoreVariant(score: number | null): BadgeProps['variant'] {
  if (score === null) return 'secondary';
  if (score < 0.5) return 'error-soft';
  if (score < 0.8) return 'warning-soft';
  return 'success-soft';
}

/** Rubric cell value → semantic token text colour. */
function rubricColour(value: number): string {
  if (value >= 0.8) return 'text-success';
  if (value >= 0.5) return 'text-warning';
  return 'text-danger';
}

export function MissionEvalScenarioDrillDown({
  scenarioId,
}: MissionEvalScenarioDrillDownProps): JSX.Element {
  const locale = useLocale();
  const [samples, setSamples] = useState<ReadonlyArray<CotSample>>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadSamples = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // api.get<T> prepends the gateway base which already includes /api/v1,
      // so the path here must be relative (no leading /api/v1).
      const path = `/parity/capability/dashboard/scenarios/${encodeURIComponent(scenarioId)}/samples`;
      const res = await api.get<SamplesResponse>(path);
      // `api.get<T>` returns `ApiResponse<T>` — unwrap the data envelope.
      setSamples(res.data?.samples ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : pickByLocale(locale, S.loadFailed));
    } finally {
      setLoading(false);
    }
  }, [scenarioId, locale]);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  const selectedSample = useMemo(
    () => samples.find((s) => s.thoughtId === selectedId) ?? null,
    [samples, selectedId],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {samples.length}{' '}
            {samples.length === 1
              ? pickByLocale(locale, S.sampleCaptured)
              : pickByLocale(locale, S.samplesCaptured)}
            <span className="ml-2 text-muted-foreground">
              ({pickByLocale(locale, S.total)}: {total.toLocaleString()})
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pickByLocale(locale, S.intro)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadSamples()}
          data-testid="refresh-button"
        >
          {pickByLocale(locale, S.refresh)}
        </Button>
      </header>

      {error && (
        <Alert variant="error">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </span>
        </Alert>
      )}

      <Card variant="outline" padding="none" className="overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        ) : samples.length === 0 ? (
          <Empty
            title={pickByLocale(locale, S.emptyTitle)}
            description={pickByLocale(locale, S.emptyBody)}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colCaptured)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colStakes)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colJudge)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colWeakest)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colModel)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {samples.map((s) => (
                <TableRow
                  key={s.thoughtId}
                  onClick={() => setSelectedId(s.thoughtId)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(s.thoughtId);
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`sample-row-${s.thoughtId}`}
                >
                  <TableCell className="text-muted-foreground">
                    {new Date(s.capturedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{s.stakes}</TableCell>
                  <TableCell>
                    <Badge variant={scoreVariant(s.judgeScore)} size="sm">
                      {s.judgeScore === null
                        ? pickByLocale(locale, S.na)
                        : s.judgeScore.toFixed(2)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.weakestAxis ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.modelId ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Drawer
        open={selectedSample !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DrawerContent side="right" size="lg" data-testid="detail-drawer">
          {selectedSample && (
            <>
              <DrawerHeader>
                <DrawerTitle>
                  {pickByLocale(locale, S.thought)}{' '}
                  {selectedSample.thoughtId.slice(0, 12)}
                </DrawerTitle>
              </DrawerHeader>
              <DrawerBody>
                <dl className="space-y-3 text-sm">
                  <Pair
                    label={pickByLocale(locale, S.thread)}
                    value={selectedSample.threadId}
                  />
                  <Pair
                    label={pickByLocale(locale, S.colCaptured)}
                    value={selectedSample.capturedAt}
                  />
                  <Pair
                    label={pickByLocale(locale, S.colStakes)}
                    value={selectedSample.stakes}
                  />
                  <Pair
                    label={pickByLocale(locale, S.colModel)}
                    value={selectedSample.modelId ?? '—'}
                  />
                  <Pair
                    label={pickByLocale(locale, S.sensor)}
                    value={selectedSample.sensorId ?? '—'}
                  />
                  <Pair
                    label={pickByLocale(locale, S.colJudge)}
                    value={
                      selectedSample.judgeScore === null
                        ? pickByLocale(locale, S.na)
                        : selectedSample.judgeScore.toFixed(2)
                    }
                  />
                  <Pair
                    label={pickByLocale(locale, S.judgeReason)}
                    value={selectedSample.judgeReasonText ?? '—'}
                  />
                  <Pair
                    label={pickByLocale(locale, S.suggestedFix)}
                    value={selectedSample.judgeSuggestedFix ?? '—'}
                  />
                  {selectedSample.rubric && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {pickByLocale(locale, S.rubric5c)}
                      </dt>
                      <dd className="mt-1 grid grid-cols-5 gap-2 text-xs">
                        <RubricCell label="comp." value={selectedSample.rubric.completeness} />
                        <RubricCell label="corr." value={selectedSample.rubric.correctness} />
                        <RubricCell label="cite" value={selectedSample.rubric.citations} />
                        <RubricCell label="cons." value={selectedSample.rubric.consistency} />
                        <RubricCell label="cand." value={selectedSample.rubric.candor} />
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      {pickByLocale(locale, S.cotThought)}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap rounded border border-border bg-surface-sunken p-3 text-xs text-foreground">
                      {selectedSample.cotThoughtText ??
                        pickByLocale(locale, S.noCot)}
                    </dd>
                  </div>
                </dl>
              </DrawerBody>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-foreground">{value}</dd>
    </div>
  );
}

function RubricCell({
  label,
  value,
}: {
  label: string;
  value: number;
}): JSX.Element {
  return (
    <div className="rounded border border-border bg-surface-sunken p-1 text-center">
      <div className={`font-mono text-sm ${rubricColour(value)}`}>
        {value.toFixed(2)}
      </div>
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
