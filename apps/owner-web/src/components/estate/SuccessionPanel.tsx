'use client';

import { Scroll, ShieldCheck } from 'lucide-react';
import {
  useSuccessionPlans,
  type SuccessionPlanRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';

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
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-sm text-neutral-400">
        {isSw ? 'Inapakia mipango ya urithi...' : 'Loading succession plans...'}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw
          ? 'Imeshindwa kupakia mipango ya urithi.'
          : 'Could not load succession plans.'}
      </div>
    );
  }

  const plans = query.data?.data?.plans ?? [];
  if (plans.length === 0) {
    return (
      <SectionCard
        title={isSw ? 'Hakuna mpango wa urithi bado' : 'No succession plan yet'}
        subtitle={
          isSw
            ? 'Tengeneza mpango wa kwanza kupitia /api/v1/estate/succession-plans.'
            : 'Create a plan via /api/v1/estate/succession-plans to start.'
        }
      >
        <div className="px-5 py-8 text-sm text-neutral-500">
          {isSw
            ? 'Mwambie Mr. Mwikila aanze kwa "tengeneza mpango wa urithi".'
            : 'Ask Mr. Mwikila to "draft a succession plan" to begin.'}
        </div>
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
  const chipLabel =
    days < 0
      ? isSw
        ? `Imepitwa siku ${Math.abs(days)}`
        : `${Math.abs(days)}d overdue`
      : isSw
        ? `Mapitio baada ya siku ${days}`
        : `Review in ${days}d`;

  return (
    <SectionCard
      title={plan.currentPrincipalName}
      subtitle={
        isSw
          ? `Mrithi aliyeteuliwa: ${plan.designatedSuccessorName} (${plan.designatedSuccessorRelation})`
          : `Designated successor: ${plan.designatedSuccessorName} (${plan.designatedSuccessorRelation})`
      }
      actions={
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface/80"
        >
          <Scroll className="h-3.5 w-3.5" />
          {isSw ? 'Tengeneza rasimu ya wosia' : 'Generate draft will'}
        </button>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone} label={chipLabel} />
          <StatusPill tone="neutral" label={plan.status} />
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <Stat
            label={isSw ? 'Mapitio ya mwisho' : 'Last review'}
            value={new Date(plan.lastReviewAt).toISOString().slice(0, 10)}
          />
          <Stat
            label={isSw ? 'Mapitio yanayofuata' : 'Next review due'}
            value={new Date(plan.nextReviewDueAt).toISOString().slice(0, 10)}
          />
          {plan.contingencySuccessorName ? (
            <Stat
              label={isSw ? 'Mrithi wa pili' : 'Contingency successor'}
              value={plan.contingencySuccessorName}
            />
          ) : null}
          {plan.designatedSuccessorNida ? (
            <Stat
              label={
                isSw
                  ? 'NIDA ya mrithi aliyeteuliwa'
                  : 'Designated successor NIDA'
              }
              value={plan.designatedSuccessorNida}
            />
          ) : null}
        </div>
        {plan.notes ? (
          <div className="rounded-md border border-border bg-surface/60 px-4 py-3 text-xs text-neutral-300">
            <div className="mb-1 inline-flex items-center gap-1 text-tiny font-semibold uppercase tracking-wide text-neutral-500">
              <ShieldCheck className="h-3 w-3" />
              {isSw ? 'Maelezo' : 'Notes'}
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
      <div className="text-tiny uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
