'use client';

import Link from 'next/link';
import { Scroll, ShieldCheck } from 'lucide-react';
import { Skeleton, Alert } from '@borjie/design-system';
import {
  useSuccessionPlans,
  type SuccessionPlanRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { StatusPill } from '@/components/shared/StatusPill';
import { pickByLocale } from '@/lib/locale-shared';
import { fmtDateForLocale } from '@/lib/format';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import {
  estateLabels,
  labelFor,
  successionExtra,
} from '@/i18n/strings/estate-lmbm';

interface SuccessionPanelProps {
  readonly locale: 'sw' | 'en';
}

const DAY_MS = 86_400_000;

/**
 * Per-group succession card with the next-review-due chip, current
 * principal, designated successor, contingency, last review, and a
 * "Generate draft will" hand-off to the document-drafter.
 */
export function SuccessionPanel({ locale }: SuccessionPanelProps) {
  const query = useSuccessionPlans();
  const isSw = locale === 'sw';

  if (query.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-48 rounded-xl border border-border" />
        <Skeleton className="h-48 rounded-xl border border-border" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, S.succession.loadError)}
      </Alert>
    );
  }

  const plans = query.data?.data?.plans ?? [];
  if (plans.length === 0) {
    return (
      <SectionCard
        title={pickByLocale(locale, S.succession.noPlanTitle)}
        subtitle={pickByLocale(locale, S.succession.noPlanSubtitle)}
      >
        <ScreenEmptyState
          icon={<Scroll className="h-6 w-6" />}
          title={pickByLocale(locale, S.succession.noPlanTitle)}
          description={pickByLocale(locale, S.succession.noPlanBody)}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      {plans.map((plan) => (
        <SuccessionCard key={plan.id} plan={plan} locale={locale} />
      ))}
    </div>
  );
}

interface SuccessionCardProps {
  readonly plan: SuccessionPlanRow;
  readonly locale: 'sw' | 'en';
}

function SuccessionCard({ plan, locale }: SuccessionCardProps) {
  const isSw = locale === 'sw';
  const due = new Date(plan.nextReviewDueAt).getTime();
  const days = Math.round((due - Date.now()) / DAY_MS);
  const tone: 'green' | 'amber' | 'red' | 'neutral' =
    days < 0 ? 'red' : days <= 30 ? 'amber' : 'green';
  const lang = isSw ? 'sw' : 'en';
  const chipLabel =
    days < 0
      ? S.succession.overdue(Math.abs(days))[lang]
      : S.succession.reviewIn(days)[lang];

  return (
    <SectionCard
      title={plan.currentPrincipalName}
      subtitle={
        S.succession.subtitle(
          plan.designatedSuccessorName,
          plan.designatedSuccessorRelation,
        )[lang]
      }
      actions={
        <Link
          href={`/ask?prompt=${encodeURIComponent(
            successionExtra.draftWillPrompt(
              plan.currentPrincipalName,
              plan.designatedSuccessorName,
              plan.designatedSuccessorRelation,
            )[lang],
          )}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface/60"
        >
          <Scroll className="h-3.5 w-3.5" />
          {isSw ? S.succession.generateDraftWill.sw : S.succession.generateDraftWill.en}
        </Link>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone} label={chipLabel} />
          <StatusPill
            tone="neutral"
            label={labelFor(estateLabels.successionStatus, plan.status, locale)}
          />
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <Stat
            label={isSw ? S.succession.lastReview.sw : S.succession.lastReview.en}
            value={fmtDateForLocale(plan.lastReviewAt, locale)}
          />
          <Stat
            label={isSw ? S.succession.nextReview.sw : S.succession.nextReview.en}
            value={fmtDateForLocale(plan.nextReviewDueAt, locale)}
          />
          {plan.contingencySuccessorName ? (
            <Stat
              label={isSw ? S.succession.contingency.sw : S.succession.contingency.en}
              value={plan.contingencySuccessorName}
            />
          ) : null}
          {plan.designatedSuccessorNida ? (
            <Stat
              label={isSw ? S.succession.designatedNida.sw : S.succession.designatedNida.en}
              value={plan.designatedSuccessorNida}
            />
          ) : null}
        </div>
        {plan.notes ? (
          <div className="rounded-md border border-border bg-surface/60 px-4 py-3 text-xs text-muted-foreground">
            <div className="mb-1 inline-flex items-center gap-1 text-tiny font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              {isSw ? S.succession.notes.sw : S.succession.notes.en}
            </div>
            {plan.notes}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
