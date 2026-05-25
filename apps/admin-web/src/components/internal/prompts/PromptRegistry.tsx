'use client';

import { useMemo, useState } from 'react';
import { StubBadge } from '../StubBadge';
import { ConfirmModal } from '../ConfirmModal';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { PromptDiff } from './PromptDiff';
import { usePromptsQuery, useSetPromptStatus } from '@/lib/internal/queries/prompts';
import type { PromptRow, PromptStatus } from '@/lib/mocks/types';

function tone(status: PromptStatus): 'success' | 'info' | 'neutral' {
  if (status === 'Production') return 'success';
  if (status === 'Canary') return 'info';
  return 'neutral';
}

export function PromptRegistry(): JSX.Element {
  const query = usePromptsQuery();
  const mutate = useSetPromptStatus();
  const [confirm, setConfirm] = useState<{ readonly row: PromptRow; readonly next: PromptStatus } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const rows = query.data?.rows ?? [];

  /**
   * For each junior, the registry shows the diff between the
   * Production version and the Canary version (if any). Picked the
   * first matching pair per junior so the UI never grows wider than
   * one diff at a time.
   */
  const diffs = useMemo(() => {
    const byJunior = new Map<string, PromptRow[]>();
    rows.forEach((r) => {
      const list = byJunior.get(r.juniorId) ?? [];
      list.push(r);
      byJunior.set(r.juniorId, list);
    });
    return Array.from(byJunior.entries()).flatMap(([juniorId, list]) => {
      const prod = list.find((p) => p.status === 'Production');
      const canary = list.find((p) => p.status === 'Canary');
      if (!prod || !canary) return [];
      return [{ juniorId, prod, canary } as const];
    });
  }, [rows]);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading prompts…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Junior</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium text-right">GEPA score</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.junior}</td>
                <td className="px-4 py-3 text-neutral-300">{row.version}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">{row.gepaScore.toFixed(3)}</td>
                <td className="px-4 py-3">
                  <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  {row.status === 'Canary' ? (
                    <button
                      type="button"
                      onClick={() => setConfirm({ row, next: 'Production' })}
                      className="text-xs text-signal-500 hover:underline"
                    >
                      Promote to production
                    </button>
                  ) : row.status === 'Production' ? (
                    <button
                      type="button"
                      onClick={() => setConfirm({ row, next: 'Archived' })}
                      className="text-xs text-warning hover:underline"
                    >
                      Roll back
                    </button>
                  ) : (
                    <span className="text-xs text-neutral-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {diffs.map(({ juniorId, prod, canary }) => (
        <section key={juniorId} className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            {prod.junior} — {prod.version} vs {canary.version}
          </h3>
          <PromptDiff
            left={{ label: `Production · ${prod.version}`, body: prod.body }}
            right={{ label: `Canary · ${canary.version}`, body: canary.body }}
          />
        </section>
      ))}

      <DataSourceBadge source={query.data?.source ?? 'mock'} />

      <ConfirmModal
        open={Boolean(confirm)}
        tone={confirm?.next === 'Production' ? 'info' : 'warn'}
        title={confirm?.next === 'Production' ? 'Promote to production' : 'Roll back to archive'}
        body={
          confirm ? (
            <>
              {confirm.next === 'Production'
                ? `Promote ${confirm.row.junior} ${confirm.row.version} to production?`
                : `Archive ${confirm.row.junior} ${confirm.row.version}? The previous production prompt will take over.`}
            </>
          ) : null
        }
        confirmLabel={confirm?.next === 'Production' ? 'Promote' : 'Roll back'}
        busy={mutate.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          mutate.mutate(
            { id: confirm.row.id, status: confirm.next },
            {
              onSuccess: () => {
                setToast(`${confirm.row.junior} ${confirm.row.version} → ${confirm.next}`);
                setConfirm(null);
              },
              onError: (err) =>
                setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
            }
          );
        }}
      />
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
