'use client';

import { useState } from 'react';
import { Button, Skeleton, EmptyState, FormField, Input } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import {
  useJuniorAis,
  useSuspendJunior,
  useRevokeJunior,
} from '@/lib/internal/wave9/queries';
import type { JuniorAi } from '@/lib/internal/wave9/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'warn';
  if (status === 'revoked') return 'danger';
  return 'neutral';
}

const S = {
  loading: { en: 'Loading provisioned juniors…', sw: 'Inapakia wadogo waliotengwa…' },
  emptyTitle: { en: 'No juniors provisioned', sw: 'Hakuna wadogo waliotengwa' },
  emptyBody: {
    en: 'No juniors are provisioned for this account yet.',
    sw: 'Hakuna wadogo waliotengwa kwa akaunti hii bado.',
  },
  provisioned: {
    en: 'provisioned · team-lead gate upstream',
    sw: 'waliotengwa · lango la kiongozi wa timu juu',
  },
  certRequired: { en: 'cert required', sw: 'cheti kinahitajika' },
  memory: { en: 'memory', sw: 'kumbukumbu' },
  suspendReason: { en: 'Suspend reason', sw: 'Sababu ya kusimamisha' },
  suspendPlaceholder: { en: 'Why pause this junior?', sw: 'Kwa nini kusitisha mdogo huyu?' },
  suspend: { en: 'Suspend', sw: 'Simamisha' },
  revoke: { en: 'Revoke', sw: 'Batilisha' },
  enterReason: { en: 'Enter a suspend reason first.', sw: 'Weka sababu ya kusimamisha kwanza.' },
  suspended: { en: 'suspended', sw: 'imesimamishwa' },
  revoked: { en: 'revoked', sw: 'imebatilishwa' },
  suspendFailed: { en: 'Suspend failed', sw: 'Kusimamisha kumeshindwa' },
  revokeFailed: { en: 'Revoke failed', sw: 'Kubatilisha kumeshindwa' },
} as const;

/**
 * Junior-AI Factory (I-W-23).
 *
 * Lists the juniors provisioned for the caller (GET /junior-ai/mine) and
 * lets an operator suspend (reversible, with reason) or revoke (terminal)
 * each one. The gateway enforces the team-lead role gate + lifecycle rules.
 */
export function JuniorAiFactory({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useJuniorAis();
  const suspend = useSuspendJunior();
  const revoke = useRevokeJunior();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onSuspend(j: JuniorAi) {
    const reason = (reasonById[j.id] ?? '').trim();
    if (reason.length < 1) {
      announce(pickByLocale(locale, S.enterReason), 'danger');
      return;
    }
    suspend.mutate(
      { id: j.id, reason },
      {
        onSuccess: () =>
          announce(`${j.id.slice(0, 8)}… ${pickByLocale(locale, S.suspended)}`, 'success'),
        onError: (err) =>
          announce(`${pickByLocale(locale, S.suspendFailed)}: ${err.message}`, 'danger'),
      },
    );
  }

  function onRevoke(j: JuniorAi) {
    revoke.mutate(j.id, {
      onSuccess: () =>
        announce(`${j.id.slice(0, 8)}… ${pickByLocale(locale, S.revoked)}`, 'success'),
      onError: (err) =>
        announce(`${pickByLocale(locale, S.revokeFailed)}: ${err.message}`, 'danger'),
    });
  }

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StubBadge tone="info">
        {items.length} {pickByLocale(locale, S.provisioned)}
      </StubBadge>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((j) => {
          const busy = suspend.isPending || revoke.isPending;
          const terminal = j.status === 'revoked';
          return (
            <article key={j.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{j.domain}</p>
                    <StubBadge tone={statusTone(j.status)}>{j.status}</StubBadge>
                    {j.certificationRequired ? (
                      <StubBadge tone="neutral">{pickByLocale(locale, S.certRequired)}</StubBadge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{j.id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{j.mandate}</p>
                </div>
                {j.memoryScope ? (
                  <StubBadge tone="neutral">
                    {j.memoryScope} {pickByLocale(locale, S.memory)}
                  </StubBadge>
                ) : null}
              </div>

              {!terminal ? (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[12rem]">
                    <FormField label={pickByLocale(locale, S.suspendReason)} name={`reason-${j.id}`}>
                      <Input
                        type="text"
                        value={reasonById[j.id] ?? ''}
                        onChange={(e) =>
                          setReasonById((prev) => ({ ...prev, [j.id]: e.target.value }))
                        }
                        placeholder={pickByLocale(locale, S.suspendPlaceholder)}
                      />
                    </FormField>
                  </div>
                  <Button
                    type="button"
                    variant="warning"
                    size="sm"
                    disabled={busy || j.status === 'suspended'}
                    onClick={() => onSuspend(j)}
                  >
                    {pickByLocale(locale, S.suspend)}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => onRevoke(j)}
                  >
                    {pickByLocale(locale, S.revoke)}
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
