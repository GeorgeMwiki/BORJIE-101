'use client';

import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Skeleton, Alert, Empty, FormField, Input } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  usePendingProposals,
  useApproveProposal,
  useDeclineProposal,
} from '@/lib/internal/wave9/queries';
import type { Proposal } from '@/lib/internal/wave9/api';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, PROPOSAL_STATUS_LABELS } from '@/lib/internal/enum-labels';

/**
 * Proposals approval queue (I-W-22).
 *
 * Lists `pending_hitl` brain↔tab module-update proposals and lets a second
 * operator approve (with an approver tier) or decline (with a reason). The
 * gateway runs the REAL state transition + four-eye / approver-tier rules;
 * this surface only renders the queue and posts the decisions.
 */
const S = {
  loading: { en: 'Loading pending proposals…', sw: 'Inapakia mapendekezo yanayosubiri…' },
  emptyTitle: { en: 'No proposals awaiting review', sw: 'Hakuna mapendekezo yanayosubiri ukaguzi' },
  emptyBody: {
    en: 'Brain↔tab module-update proposals awaiting a second operator appear here.',
    sw: 'Mapendekezo ya kusasisha moduli kati ya ubongo na kichupo yanayosubiri opereta wa pili huonekana hapa.',
  },
  pending: { en: 'pending · four-eye enforced upstream', sw: 'yanasubiri · macho-manne yanatekelezwa juu' },
  persona: { en: 'persona', sw: 'mtu binafsi' },
  conf: { en: 'conf', sw: 'uhakika' },
  priority: { en: 'priority', sw: 'kipaumbele' },
  approverTier: { en: 'Approver tier', sw: 'Daraja la mthibitishaji' },
  approve: { en: 'Approve', sw: 'Idhinisha' },
  declineReason: { en: 'Decline reason', sw: 'Sababu ya kukataa' },
  declineReasonPlaceholder: { en: 'Why is this being declined?', sw: 'Kwa nini hili linakataliwa?' },
  decline: { en: 'Decline', sw: 'Kataa' },
  enterReason: { en: 'Enter a decline reason first.', sw: 'Weka sababu ya kukataa kwanza.' },
  approveOk: { en: 'Proposal', sw: 'Pendekezo' },
  approveFailed: { en: 'Approve failed', sw: 'Kuidhinisha kumeshindwa' },
  declineFailed: { en: 'Decline failed', sw: 'Kukataa kumeshindwa' },
} as const;

export function ProposalsQueue({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = usePendingProposals();
  const approve = useApproveProposal();
  const decline = useDeclineProposal();
  const [toast, setToast] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'danger'>('success');
  const [tierById, setTierById] = useState<Record<string, number>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  function announce(message: string, nextTone: 'success' | 'danger') {
    setTone(nextTone);
    setToast(message);
  }

  function onApprove(p: Proposal) {
    const tier = tierById[p.id] ?? 1;
    approve.mutate(
      { id: p.id, approverTier: tier },
      {
        onSuccess: (res) =>
          announce(
            `${pickByLocale(locale, S.approveOk)} ${res.id.slice(0, 8)}… → ${localizeEnumLabel(
              PROPOSAL_STATUS_LABELS,
              res.status,
              locale,
            )}`,
            'success',
          ),
        onError: (err) =>
          announce(
            `${pickByLocale(locale, S.approveFailed)}: ${localizeApiError(err, locale)}`,
            'danger',
          ),
      },
    );
  }

  function onDecline(p: Proposal) {
    const reason = (reasonById[p.id] ?? '').trim();
    if (reason.length < 1) {
      announce(pickByLocale(locale, S.enterReason), 'danger');
      return;
    }
    decline.mutate(
      { id: p.id, reason },
      {
        onSuccess: (res) =>
          announce(
            `${pickByLocale(locale, S.approveOk)} ${res.id.slice(0, 8)}… → ${localizeEnumLabel(
              PROPOSAL_STATUS_LABELS,
              res.status,
              locale,
            )}`,
            'success',
          ),
        onError: (err) =>
          announce(
            `${pickByLocale(locale, S.declineFailed)}: ${localizeApiError(err, locale)}`,
            'danger',
          ),
      },
    );
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
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <Empty
        icon={<ClipboardCheck className="h-8 w-8" />}
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <StubBadge tone="info">
          {items.length} {pickByLocale(locale, S.pending)}
        </StubBadge>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((p) => {
          const busy = approve.isPending || decline.isPending;
          return (
            <article key={p.id} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-foreground">{p.action ?? 'update'}</p>
                    {p.moduleTemplateId ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.moduleTemplateId}
                      </span>
                    ) : null}
                    {p.hitlRequired ? <StubBadge tone="warn">HITL</StubBadge> : null}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">{p.id}</p>
                  {p.personaId ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pickByLocale(locale, S.persona)}: {p.personaId}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {typeof p.confidence === 'number' ? (
                    <StubBadge tone="neutral">
                      {pickByLocale(locale, S.conf)} {Math.round(p.confidence * 100)}%
                    </StubBadge>
                  ) : null}
                  {p.priority !== null && p.priority !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      {pickByLocale(locale, S.priority)} {String(p.priority)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <FormField
                  label={pickByLocale(locale, S.approverTier)}
                  htmlFor={`tier-${p.id}`}
                  className="w-24 space-y-1"
                >
                  <Input
                    id={`tier-${p.id}`}
                    type="number"
                    min={1}
                    max={5}
                    inputSize="sm"
                    value={tierById[p.id] ?? 1}
                    onChange={(e) =>
                      setTierById((prev) => ({
                        ...prev,
                        [p.id]: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                      }))
                    }
                  />
                </FormField>
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  disabled={busy}
                  loading={approve.isPending}
                  onClick={() => onApprove(p)}
                >
                  {pickByLocale(locale, S.approve)}
                </Button>

                <FormField
                  label={pickByLocale(locale, S.declineReason)}
                  htmlFor={`reason-${p.id}`}
                  className="flex-1 min-w-[12rem] space-y-1"
                >
                  <Input
                    id={`reason-${p.id}`}
                    type="text"
                    inputSize="sm"
                    value={reasonById[p.id] ?? ''}
                    onChange={(e) =>
                      setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder={pickByLocale(locale, S.declineReasonPlaceholder)}
                  />
                </FormField>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  loading={decline.isPending}
                  onClick={() => onDecline(p)}
                >
                  {pickByLocale(locale, S.decline)}
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <Toast message={toast} tone={tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
