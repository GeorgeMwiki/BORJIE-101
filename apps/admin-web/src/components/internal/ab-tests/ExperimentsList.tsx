'use client';

import { useState } from 'react';
import { Button } from '@borjie/design-system';
import {
  useExperimentsQuery,
  useCreateExperiment,
  type Experiment,
} from '@/lib/internal/queries/ab-tests';
import { AbTestActions } from './AbTestActions';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';

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

export function ExperimentsList(): JSX.Element {
  const query = useExperimentsQuery();

  return (
    <div className="space-y-6">
      <NewExperimentForm />

      {query.isPending ? (
        <p className="text-sm text-neutral-500">Loading experiments…</p>
      ) : query.isError ? (
        <p className="text-sm text-danger">{query.error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-sunken">
              <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium">Junior</th>
                <th className="px-4 py-3 text-right font-medium">Golden score</th>
                <th className="px-4 py-3 text-right font-medium">Canary tenants</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-xs text-neutral-500"
                  >
                    No experiments yet. Create one above.
                  </td>
                </tr>
              ) : (
                (query.data ?? []).map((row: Experiment) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-3 text-foreground">{row.variant}</td>
                    <td className="px-4 py-3 text-neutral-300">{row.junior}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                      {row.goldenScore != null
                        ? row.goldenScore.toFixed(3)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                      {row.canaryTenants.length}
                    </td>
                    <td className="px-4 py-3">
                      <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === 'promoted' ? (
                        <span className="text-xs text-neutral-500">Promoted</span>
                      ) : (
                        <AbTestActions id={row.id} variant={row.variant} />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <DataSourceBadge source="live" />
    </div>
  );
}

function NewExperimentForm(): JSX.Element {
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
          setToast('Experiment created');
          setVariant('');
          setJunior('');
          setGoldenScore('');
        },
        onError: (err) =>
          setToast(
            `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
          ),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-6 md:grid-cols-4"
    >
      <label className="text-sm md:col-span-2">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Variant
        </span>
        <input
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
          placeholder="geology v18-rc vs v17"
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Junior
        </span>
        <input
          value={junior}
          onChange={(e) => setJunior(e.target.value)}
          placeholder="Geology"
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Golden score (0–1)
        </span>
        <input
          value={goldenScore}
          onChange={(e) => setGoldenScore(e.target.value)}
          inputMode="decimal"
          placeholder="0.871"
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </label>
      <div className="flex justify-end md:col-span-4">
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={create.isPending}
        >
          {create.isPending ? 'Creating…' : 'New experiment'}
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
