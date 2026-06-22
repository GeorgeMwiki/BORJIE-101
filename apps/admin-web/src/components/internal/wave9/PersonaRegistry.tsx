'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Button, Skeleton, Alert, Empty } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { ConfirmModal } from '../ConfirmModal';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  usePersonas,
  useRefreshPersonas,
  useDeletePersona,
} from '@/lib/internal/wave9/queries';
import type { Persona } from '@/lib/internal/wave9/api';

/**
 * Persona registry (I-W-25, SUPER_ADMIN / ADMIN).
 *
 * Lists every brain persona (platform + tenant) and lets an operator
 * refresh from the DB or remove a persona. The gateway gates every route on
 * SUPER_ADMIN / ADMIN and fans hot-swaps out across the cross-portal bus.
 */
const S = {
  loading: { en: 'Loading persona registry…', sw: 'Inapakia rejista ya watu binafsi…' },
  badge: { en: 'SUPER_ADMIN · cross-portal hot-swap', sw: 'SUPER_ADMIN · ubadilishaji-moto baina ya milango' },
  refresh: { en: 'Refresh from DB', sw: 'Onyesha upya kutoka DB' },
  emptyTitle: { en: 'No personas registered', sw: 'Hakuna watu binafsi waliosajiliwa' },
  emptyBody: {
    en: 'Brain personas appear here once they are registered for the platform or a tenant.',
    sw: 'Watu binafsi wa ubongo huonekana hapa mara wanaposajiliwa kwa jukwaa au mteja.',
  },
  delete: { en: 'Delete', sw: 'Futa' },
  deleteTitle: { en: 'Remove persona', sw: 'Ondoa mtu binafsi' },
  deleteConfirm: { en: 'Delete persona', sw: 'Futa mtu binafsi' },
  taboos: { en: 'taboos', sw: 'miiko' },
} as const;

export function PersonaRegistry({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = usePersonas();
  const refresh = useRefreshPersonas();
  const remove = useDeletePersona();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [target, setTarget] = useState<Persona | null>(null);

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onRefresh() {
    refresh.mutate(undefined, {
      onSuccess: () => announce('Persona registry refreshed from DB.', 'success'),
      onError: (err) => announce(`Refresh failed: ${err.message}`, 'danger'),
    });
  }

  function onConfirmDelete() {
    if (!target) return;
    const p = target;
    remove.mutate(p.id, {
      onSuccess: () => {
        announce(`Persona '${p.id}' removed.`, 'success');
        setTarget(null);
      },
      onError: (err) => announce(`Delete failed: ${err.message}`, 'danger'),
    });
  }

  if (query.isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{query.error.message}</Alert>;
  }

  const personas = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StubBadge tone="danger">{pickByLocale(locale, S.badge)}</StubBadge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          loading={refresh.isPending}
          onClick={onRefresh}
        >
          {pickByLocale(locale, S.refresh)}
        </Button>
      </div>

      {personas.length === 0 ? (
        <Empty
          icon={<Users className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {personas.map((p) => (
            <article key={p.id} className="flex flex-col gap-2 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{p.displayName}</p>
                    <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                    <StubBadge tone="neutral">{p.firstPersonNoun}</StubBadge>
                  </div>
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{p.openingStatement}”
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.toneGuidance}</p>
                  {p.taboos.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pickByLocale(locale, S.taboos)}: {p.taboos.join(', ')}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => setTarget(p)}
                  className="shrink-0"
                >
                  {pickByLocale(locale, S.delete)}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmModal
        open={Boolean(target)}
        tone="danger"
        title={pickByLocale(locale, S.deleteTitle)}
        body={target ? <>{target.displayName} ({target.id})</> : null}
        confirmLabel={pickByLocale(locale, S.deleteConfirm)}
        busy={remove.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={onConfirmDelete}
      />

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
