'use client';

import { useState } from 'react';
import {
  Button,
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  FormField,
  Input,
} from '@borjie/design-system';
import {
  useExperimentsQuery,
  useCreateExperiment,
  type Experiment,
} from '@/lib/internal/queries/ab-tests';
import { AbTestActions } from './AbTestActions';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, EXPERIMENT_STATUS_LABELS } from '@/lib/internal/enum-labels';

const S = {
  loading: { en: 'Loading experiments…', sw: 'Inapakia majaribio…' },
  emptyTitle: { en: 'No experiments yet', sw: 'Hakuna majaribio bado' },
  emptyBody: {
    en: 'Create the first experiment above to start an A/B run.',
    sw: 'Tengeneza jaribio la kwanza hapo juu kuanza mzunguko wa A/B.',
  },
  colVariant: { en: 'Variant', sw: 'Toleo' },
  colJunior: { en: 'Junior', sw: 'Mdogo' },
  colScore: { en: 'Golden score', sw: 'Alama ya dhahabu' },
  colCanary: { en: 'Canary tenants', sw: 'Wateja wa majaribio' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colActions: { en: 'Actions', sw: 'Vitendo' },
  promoted: { en: 'Promoted', sw: 'Imepandishwa' },
  formVariant: { en: 'Variant', sw: 'Toleo' },
  formJunior: { en: 'Junior', sw: 'Mdogo' },
  formScore: { en: 'Golden score (0–1)', sw: 'Alama ya dhahabu (0–1)' },
  newExperiment: { en: 'New experiment', sw: 'Jaribio jipya' },
  creating: { en: 'Creating…', sw: 'Inatengeneza…' },
  created: { en: 'Experiment created', sw: 'Jaribio limetengenezwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

/**
 * Live HQ A/B experiment harness.
 *
 * Binds to GET/POST /api/v1/mining/internal/ab-tests over the real
 * `ab_experiments` table. Supports creating an experiment and promoting a
 * winner inline. Empty until the first experiment is created.
 */
function tone(status: string): 'success' | 'danger' | 'info' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'won' || s === 'promoted') return 'success';
  if (s === 'lost') return 'danger';
  if (s === 'running') return 'info';
  return 'neutral';
}

export function ExperimentsList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useExperimentsQuery();
  const experiments = query.data ?? [];

  return (
    <div className="space-y-6">
      <NewExperimentForm locale={locale} />

      {query.isPending ? (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-2/3 rounded-md" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-danger">{localizeApiError(query.error, locale)}</p>
      ) : experiments.length === 0 ? (
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colVariant)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colJunior)}</TableHead>
                <TableHead className="text-right">{pickByLocale(locale, S.colScore)}</TableHead>
                <TableHead className="text-right">{pickByLocale(locale, S.colCanary)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
                <TableHead>
                  <span className="sr-only">{pickByLocale(locale, S.colActions)}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {experiments.map((row: Experiment) => (
                <TableRow key={row.id}>
                  <TableCell className="text-foreground">{row.variant}</TableCell>
                  <TableCell className="text-muted-foreground">{row.junior}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.goldenScore != null ? row.goldenScore.toFixed(3) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.canaryTenants.length}
                  </TableCell>
                  <TableCell>
                    <StubBadge tone={tone(row.status)}>
                      {localizeEnumLabel(EXPERIMENT_STATUS_LABELS, row.status, locale)}
                    </StubBadge>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === 'promoted' ? (
                      <span className="text-xs text-muted-foreground">
                        {pickByLocale(locale, S.promoted)}
                      </span>
                    ) : (
                      <AbTestActions id={row.id} variant={row.variant} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DataSourceBadge source="live" locale={locale} />
    </div>
  );
}

function NewExperimentForm({ locale }: { readonly locale: Locale }): JSX.Element {
  const create = useCreateExperiment();
  const [variant, setVariant] = useState('');
  const [junior, setJunior] = useState('');
  const [goldenScore, setGoldenScore] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const canSubmit =
    variant.trim().length > 0 && junior.trim().length > 0 && !create.isPending;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    const score = goldenScore.trim() === '' ? undefined : Number(goldenScore);
    create.mutate(
      {
        variant: variant.trim(),
        junior: junior.trim(),
        ...(score != null && Number.isFinite(score) ? { goldenScore: score } : {}),
      },
      {
        onSuccess: () => {
          setToast(pickByLocale(locale, S.created));
          setVariant('');
          setJunior('');
          setGoldenScore('');
        },
        onError: (err) =>
          setToast(
            `${pickByLocale(locale, S.failed)}: ${
              localizeApiError(err, locale)
            }`,
          ),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-6 md:grid-cols-4"
    >
      <div className="md:col-span-2">
        <FormField label={pickByLocale(locale, S.formVariant)} name="variant">
          <Input
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            placeholder="geology v18-rc vs v17"
          />
        </FormField>
      </div>
      <FormField label={pickByLocale(locale, S.formJunior)} name="junior">
        <Input
          value={junior}
          onChange={(e) => setJunior(e.target.value)}
          placeholder="Geology"
        />
      </FormField>
      <FormField label={pickByLocale(locale, S.formScore)} name="goldenScore">
        <Input
          value={goldenScore}
          onChange={(e) => setGoldenScore(e.target.value)}
          inputMode="decimal"
          placeholder="0.871"
        />
      </FormField>
      <div className="flex justify-end md:col-span-4">
        <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
          {create.isPending
            ? pickByLocale(locale, S.creating)
            : pickByLocale(locale, S.newExperiment)}
        </Button>
      </div>
      <Toast
        message={toast}
        tone={create.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </form>
  );
}
