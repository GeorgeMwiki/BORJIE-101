'use client';

import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import {
  Button,
  Skeleton,
  Alert,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { ConfirmModal } from '../ConfirmModal';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { PromptDiff } from './PromptDiff';
import { usePromptsQuery, useSetPromptStatus } from '@/lib/internal/queries/prompts';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { PromptRow, PromptStatus } from '@/lib/internal/types';

const S = {
  loading: { en: 'Loading prompts…', sw: 'Inapakia maagizo…' },
  emptyTitle: { en: 'No prompts registered', sw: 'Hakuna maagizo yaliyosajiliwa' },
  emptyBody: {
    en: 'Junior prompt versions appear here once they are promoted through the registry.',
    sw: 'Matoleo ya maagizo ya wasaidizi huonekana hapa mara yanapopandishwa kupitia rejista.',
  },
  colJunior: { en: 'Junior', sw: 'Msaidizi' },
  colVersion: { en: 'Version', sw: 'Toleo' },
  colGepa: { en: 'GEPA score', sw: 'Alama ya GEPA' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colActions: { en: 'Actions', sw: 'Vitendo' },
  promote: { en: 'Promote to production', sw: 'Pandisha hadi uzalishaji' },
  rollback: { en: 'Roll back', sw: 'Rejesha nyuma' },
  promoteTitle: { en: 'Promote to production', sw: 'Pandisha hadi uzalishaji' },
  rollbackTitle: { en: 'Roll back to archive', sw: 'Rejesha hadi kumbukumbu' },
  promoteConfirm: { en: 'Promote', sw: 'Pandisha' },
  rollbackConfirm: { en: 'Roll back', sw: 'Rejesha nyuma' },
  vs: { en: 'vs', sw: 'dhidi ya' },
} as const;

function tone(status: PromptStatus): 'success' | 'info' | 'neutral' {
  if (status === 'Production') return 'success';
  if (status === 'Canary') return 'info';
  return 'neutral';
}

export function PromptRegistry({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
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

  if (query.isPending) {
    return (
      <Skeleton
        className="h-64 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{query.error.message}</Alert>;
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<Inbox className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colJunior)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colVersion)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colGepa)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
              <TableHead>
                <span className="sr-only">{pickByLocale(locale, S.colActions)}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-foreground">{row.junior}</TableCell>
                <TableCell className="text-muted-foreground">{row.version}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.gepaScore.toFixed(3)}
                </TableCell>
                <TableCell>
                  <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                </TableCell>
                <TableCell className="text-right">
                  {row.status === 'Canary' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => setConfirm({ row, next: 'Production' })}
                      className="h-auto p-0 text-signal-500"
                    >
                      {pickByLocale(locale, S.promote)}
                    </Button>
                  ) : row.status === 'Production' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => setConfirm({ row, next: 'Archived' })}
                      className="h-auto p-0 text-warning"
                    >
                      {pickByLocale(locale, S.rollback)}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {diffs.map(({ juniorId, prod, canary }) => (
        <section key={juniorId} className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">
            {prod.junior} — {prod.version} {pickByLocale(locale, S.vs)} {canary.version}
          </h3>
          <PromptDiff
            left={{ label: `Production · ${prod.version}`, body: prod.body }}
            right={{ label: `Canary · ${canary.version}`, body: canary.body }}
          />
        </section>
      ))}

      <DataSourceBadge source={query.data?.source ?? 'live'} />

      <ConfirmModal
        open={Boolean(confirm)}
        tone={confirm?.next === 'Production' ? 'info' : 'warn'}
        title={
          confirm?.next === 'Production'
            ? pickByLocale(locale, S.promoteTitle)
            : pickByLocale(locale, S.rollbackTitle)
        }
        body={
          confirm ? (
            <>
              {confirm.next === 'Production'
                ? `Promote ${confirm.row.junior} ${confirm.row.version} to production?`
                : `Archive ${confirm.row.junior} ${confirm.row.version}? The previous production prompt will take over.`}
            </>
          ) : null
        }
        confirmLabel={
          confirm?.next === 'Production'
            ? pickByLocale(locale, S.promoteConfirm)
            : pickByLocale(locale, S.rollbackConfirm)
        }
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
