'use client';

import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button, Skeleton, Alert, Empty } from '@borjie/design-system';
import { ConfirmModal } from '../ConfirmModal';
import { DataSourceBadge } from '../DataSourceBadge';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { usePromotionsQuery, useRevertPromotion } from '@/lib/internal/queries/rollback';
import type { PromotionRow } from '@/lib/internal/types';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, PROMOTION_KIND_LABELS } from '@/lib/internal/enum-labels';

const S = {
  loading: { en: 'Loading promotions…', sw: 'Inapakia upandishaji…' },
  emptyTitle: { en: 'No promotions', sw: 'Hakuna upandishaji' },
  emptyBody: {
    en: 'Recent promotions appear here. A revert emits an audit event and notifies the platform channel.',
    sw: 'Upandishaji wa hivi karibuni huonekana hapa. Kurudisha hutoa tukio la ukaguzi na kuarifu chaneli ya jukwaa.',
  },
  by: { en: 'by', sw: 'na' },
  revertNow: { en: 'Revert now', sw: 'Rudisha sasa' },
  windowClosed: { en: 'Window closed', sw: 'Dirisha limefungwa' },
  revertTitle: { en: 'Revert promotion', sw: 'Rudisha upandishaji' },
  revertBodyBefore: { en: 'Roll back ', sw: 'Rudisha ' },
  revertBodyAfter: {
    en: '? This will emit an audit event and notify the platform channel.',
    sw: '? Hii itatoa tukio la ukaguzi na kuarifu chaneli ya jukwaa.',
  },
  revertConfirm: { en: 'Revert', sw: 'Rudisha' },
  reverted: { en: 'reverted', sw: 'imerudishwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

export function RollbackPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = usePromotionsQuery();
  const revert = useRevertPromotion();
  const [target, setTarget] = useState<PromotionRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<Undo2 className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StubBadge tone="info">
                  {localizeEnumLabel(PROMOTION_KIND_LABELS, row.kind, locale)}
                </StubBadge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.promotedAt.replace('T', ' ').slice(0, 16)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {pickByLocale(locale, S.by)} {row.promotedBy}
                </span>
              </div>
              <p className="text-sm text-foreground">{row.subject}</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!row.canRevert || revert.isPending}
              onClick={() => setTarget(row)}
            >
              {row.canRevert
                ? pickByLocale(locale, S.revertNow)
                : pickByLocale(locale, S.windowClosed)}
            </Button>
          </div>
        ))}
      </div>

      <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />

      <ConfirmModal
        open={Boolean(target)}
        tone="danger"
        title={pickByLocale(locale, S.revertTitle)}
        body={
          target ? (
            <>
              {pickByLocale(locale, S.revertBodyBefore)}
              <strong className="text-foreground">{target.subject}</strong>
              {pickByLocale(locale, S.revertBodyAfter)}
            </>
          ) : null
        }
        confirmLabel={pickByLocale(locale, S.revertConfirm)}
        busy={revert.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (!target) return;
          revert.mutate(target.id, {
            onSuccess: () => {
              setToast(`${target.subject} ${pickByLocale(locale, S.reverted)}`);
              setTarget(null);
            },
            onError: (err) =>
              setToast(
                `${pickByLocale(locale, S.failed)}: ${localizeApiError(err, locale)}`,
              ),
          });
        }}
      />
      <Toast message={toast} tone={revert.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}
