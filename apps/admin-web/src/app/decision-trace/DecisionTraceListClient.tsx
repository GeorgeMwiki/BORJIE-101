'use client';

/**
 * DecisionTrace list (admin replay UI) — INV-A / FIRE-2.
 *
 * METADATA-ONLY. This client fetches the metadata-only projection from the
 * gateway:
 *
 *   GET /api/v1/mining/internal/decision-trace?tenant=&outcome=&limit=
 *
 * It NEVER reads decision CONTENT (inputs / branches / rationale / output /
 * attributes) — that crosses the control-plane wall and is served only under
 * a tenant-consented break-glass grant on the detail page. The
 * SUPABASE_SERVICE_ROLE_KEY that the previous server-component held has been
 * removed entirely; auth is the platform-session cookie carried by `api`.
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`. Outcome strings are the gateway wire contract
 * (lowercase enum) and are kept verbatim as data values.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Button,
  Card,
  Skeleton,
  Alert,
  Badge,
  Empty,
  FormField,
  Input,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  type BadgeProps,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeEnumLabel, DECISION_OUTCOME_LABELS } from '@/lib/internal/enum-labels';

interface TraceMetaRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly startedAt: string;
  readonly finalisedAt: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly chosenBranchId: string | null;
}

const S = {
  intro: {
    en: 'Metadata-only fleet view. Decision content (inputs, branches, rationale, output) is tenant business data — open a trace to request tenant-consented break-glass access.',
    sw: 'Mwonekano wa metadata pekee. Maudhui ya uamuzi (ingizo, matawi, hoja, matokeo) ni data ya biashara ya mteja — fungua ufuatiliaji kuomba ufikiaji wa dharura ulioidhinishwa na mteja.',
  },
  tenant: { en: 'Tenant', sw: 'Mteja' },
  anyTenant: { en: 'any tenant', sw: 'mteja yeyote' },
  outcome: { en: 'Outcome', sw: 'Matokeo' },
  any: { en: 'any', sw: 'yoyote' },
  filter: { en: 'Filter', sw: 'Chuja' },
  loadFailed: { en: 'Failed to load traces', sw: 'Imeshindwa kupakia ufuatiliaji' },
  traces: { en: 'traces', sw: 'ufuatiliaji' },
  trace: { en: 'trace', sw: 'ufuatiliaji mmoja' },
  emptyTitle: {
    en: 'No traces match these filters',
    sw: 'Hakuna ufuatiliaji unaolingana na vichujio hivi',
  },
  emptyBody: {
    en: 'Clear the tenant or outcome filter to see more decision traces.',
    sw: 'Futa kichujio cha mteja au matokeo kuona ufuatiliaji zaidi.',
  },
  colStarted: { en: 'Started', sw: 'Ilianza' },
  colAction: { en: 'Action', sw: 'Kitendo' },
  colDuration: { en: 'Duration', sw: 'Muda' },
  platform: { en: 'platform', sw: 'jukwaa' },
  inspect: { en: 'Inspect', sw: 'Kagua' },
} as const;

const OUTCOME_VARIANT: Record<string, BadgeProps['variant']> = {
  approved: 'success-soft',
  executed: 'success-soft',
  rejected: 'error-soft',
  refused: 'warning-soft',
  failed: 'error-soft',
};

function outcomeVariant(outcome: string): BadgeProps['variant'] {
  // eslint-disable-next-line security/detect-object-injection -- closed const map, ?? guards unknown keys
  return OUTCOME_VARIANT[outcome] ?? 'secondary';
}

export function DecisionTraceListClient({ initialLocale }: { readonly initialLocale?: Locale } = {}) {
  const locale = useLocale(initialLocale);
  const [rows, setRows] = useState<readonly TraceMetaRow[]>([]);
  const [tenant, setTenant] = useState('');
  const [outcome, setOutcome] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (tenant) qs.set('tenant', tenant);
    if (outcome) qs.set('outcome', outcome);
    qs.set('limit', '50');
    const res = await api.get<readonly TraceMetaRow[]>(
      `/mining/internal/decision-trace?${qs.toString()}`,
    );
    setLoading(false);
    if (res.success && res.data) setRows(res.data);
    else setError(res.error ?? pickByLocale(locale, S.loadFailed));
  }, [tenant, outcome, locale]);

  useEffect(() => {
    void load();
    // initial load only; filter button re-runs explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {pickByLocale(locale, S.intro)}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField
          label={pickByLocale(locale, S.tenant)}
          name="tenant"
          className="w-48"
        >
          <Input
            type="text"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            placeholder={pickByLocale(locale, S.anyTenant)}
          />
        </FormField>
        <FormField
          label={pickByLocale(locale, S.outcome)}
          name="outcome"
          className="min-w-[10rem]"
        >
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            aria-label={pickByLocale(locale, S.outcome)}
            className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">{pickByLocale(locale, S.any)}</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="executed">executed</option>
            <option value="refused">refused</option>
            <option value="failed">failed</option>
          </select>
        </FormField>
        <Button type="submit" size="sm" loading={loading}>
          {pickByLocale(locale, S.filter)}
        </Button>
      </form>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="text-xs text-muted-foreground">
        {loading
          ? null
          : `${rows.length} ${rows.length === 1 ? pickByLocale(locale, S.trace) : pickByLocale(locale, S.traces)}`}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 && !error ? (
        <Empty
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colStarted)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colAction)}</TableHead>
                <TableHead>{pickByLocale(locale, S.tenant)}</TableHead>
                <TableHead>{pickByLocale(locale, S.outcome)}</TableHead>
                <TableHead className="text-right">
                  {pickByLocale(locale, S.colDuration)}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(row.startedAt).toISOString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.name}</TableCell>
                  <TableCell className="text-xs">
                    {row.tenantId ?? (
                      <span className="italic text-muted-foreground">
                        {pickByLocale(locale, S.platform)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={outcomeVariant(row.outcome)} size="sm">
                      {localizeEnumLabel(DECISION_OUTCOME_LABELS, row.outcome, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {row.durationMs}ms
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/decision-trace/${encodeURIComponent(row.id)}${
                        row.tenantId
                          ? `?tenant=${encodeURIComponent(row.tenantId)}`
                          : ''
                      }`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-info hover:underline"
                    >
                      {pickByLocale(locale, S.inspect)}
                      <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
