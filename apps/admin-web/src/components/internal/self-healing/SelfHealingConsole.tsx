'use client';

/**
 * Internal-admin Self-Healing Console (I-W-27).
 *
 * Lists every UI/wiring blocker the MAPE-K loop reported — needs-approval,
 * code-gated repair proposals AND auto-healed observations (crystallization
 * candidates). Each row shows the insight (why + blast radius) + the action
 * plan. The admin APPROVES a fix (accepts the repair plan) or DENIES it
 * (accepts the degrade). Auto-healed observations carry an "acknowledge"
 * (deny) so the queue can be cleared once reviewed.
 *
 * This is platform-internal: the owner never sees it. The customer was already
 * served (every blocker proceeds via degrade), so nothing here is an outage.
 */

import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { Button, Skeleton, Alert, Empty } from '@borjie/design-system';
import { StubBadge } from '@/components/internal/StubBadge';
import { Toast } from '@/components/internal/Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import {
  useSelfHealingQueueQuery,
  useDecideRepairProposal,
  type RepairProposalView,
} from '@/lib/internal/queries/self-healing';

const S = {
  loading: { en: 'Loading self-healing queue…', sw: 'Inapakia foleni ya kujiponya…' },
  intro: {
    en: 'Blockers the platform healed or escalated. The customer was always served (every blocker degrades, never breaks). Approve a fix to accept its repair plan; dismiss to accept the degrade.',
    sw: 'Vizuizi jukwaa lilivyoponya au kupandisha. Mteja alihudumiwa kila wakati (kila kizuizi hupunguza, hakivunji). Idhinisha marekebisho kukubali mpango wake; tupilia mbali kukubali upunguzaji.',
  },
  open: { en: 'open', sw: 'wazi' },
  emptyTitle: { en: 'Queue is empty', sw: 'Foleni iko tupu' },
  emptyBody: {
    en: 'Nothing to heal. Repair proposals and auto-healed observations appear here.',
    sw: 'Hakuna cha kuponya. Mapendekezo ya marekebisho na uchunguzi uliojiponya huonekana hapa.',
  },
  needsApproval: { en: 'Needs approval', sw: 'Inahitaji idhini' },
  autoHealed: { en: 'Auto-healed · observation', sw: 'Imejiponya · uchunguzi' },
  suggestedFix: { en: 'Suggested fix', sw: 'Marekebisho yaliyopendekezwa' },
  firstSeenTenant: { en: 'first-seen tenant', sw: 'mteja aliyeonekana kwanza' },
  approveFix: { en: 'Approve fix', sw: 'Idhinisha marekebisho' },
  denyDegrade: { en: 'Deny (accept degrade)', sw: 'Kataa (kubali upunguzaji)' },
  dismiss: { en: 'Dismiss', sw: 'Tupilia mbali' },
  approved: { en: 'approved', sw: 'imeidhinishwa' },
  dismissed: { en: 'dismissed', sw: 'imetupiliwa mbali' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

function kindTone(p: RepairProposalView): 'danger' | 'warn' | 'info' {
  if (p.needsApproval) return 'danger';
  if (p.repairClass.startsWith('escalate')) return 'warn';
  return 'info';
}

function statusLabel(p: RepairProposalView, locale: Locale): string {
  if (p.needsApproval) return pickByLocale(locale, S.needsApproval);
  if (p.status === 'auto-healed') return pickByLocale(locale, S.autoHealed);
  return p.status;
}

export function SelfHealingConsole({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useSelfHealingQueueQuery();
  const decide = useDecideRepairProposal();
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

  const act = (p: RepairProposalView, decision: 'approve' | 'deny') => {
    decide.mutate(
      { id: p.id, decision },
      {
        onSuccess: () =>
          setToast(
            `${p.title}: ${decision === 'approve' ? pickByLocale(locale, S.approved) : pickByLocale(locale, S.dismissed)}`,
          ),
        onError: (err) =>
          setToast(
            `${pickByLocale(locale, S.failed)}: ${localizeApiError(err, locale)}`,
          ),
      },
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {pickByLocale(locale, S.intro)} {rows.length} {pickByLocale(locale, S.open)}.
      </p>

      {rows.length === 0 ? (
        <Empty
          icon={<HeartPulse className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((p) => (
            <article key={p.id} className="px-4 py-4">
              <div className="mb-1 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{p.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {p.locus}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StubBadge tone={kindTone(p)}>{statusLabel(p, locale)}</StubBadge>
                  {p.occurrenceCount > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      ×{p.occurrenceCount}
                    </span>
                  ) : null}
                </div>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">{p.insight}</p>

              {p.actionPlan.length > 0 ? (
                <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {p.actionPlan.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              ) : null}

              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {pickByLocale(locale, S.suggestedFix)}:
                </span>{' '}
                {p.suggestedFix}
                {p.tenantId ? (
                  <>
                    {' · '}
                    <span className="font-medium text-foreground">
                      {pickByLocale(locale, S.firstSeenTenant)}:
                    </span>{' '}
                    {p.tenantId}
                  </>
                ) : null}
              </div>

              <div className="mt-3 flex gap-2">
                {p.needsApproval ? (
                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => act(p, 'approve')}
                  >
                    {pickByLocale(locale, S.approveFix)}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => act(p, 'deny')}
                >
                  {p.needsApproval
                    ? pickByLocale(locale, S.denyDegrade)
                    : pickByLocale(locale, S.dismiss)}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Toast
        message={toast}
        tone={decide.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
