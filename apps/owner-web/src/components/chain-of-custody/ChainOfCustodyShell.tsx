'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Link as LinkIcon,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { Alert, Button, Input, Skeleton } from '@borjie/design-system';
import { useChainOfCustody, type ChainStep } from '@/lib/queries/ops';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { fmtDateForLocale, fmtTimeForLocale } from '@/lib/format';
import {
  chainOfCustodyStrings as S,
  chainActionLabels,
} from '@/i18n/strings/chain-of-custody';

/**
 * Chain-of-custody visualiser — owner enters a parcelId, sees the
 * ordered pit-to-buyer timeline plus a hash-chain integrity badge.
 *
 * The timeline reads top-down. The audit chain is replayed in the
 * server response (`verification.ok` and `verification.brokenAt`) so
 * any tamper is rendered as a red badge with the broken step index.
 */
export function ChainOfCustodyShell({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const [input, setInput] = useState('');
  const [parcelId, setParcelId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useChainOfCustody(parcelId);
  const payload = data?.data ?? null;
  const steps = payload?.steps ?? [];
  const verification = payload?.verification ?? null;

  return (
    <section className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setParcelId(input.trim() || null);
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-column-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pickByLocale(locale, S.parcelPlaceholder)}
            className="pl-9"
          />
        </div>
        <Button type="submit" size="sm">
          {pickByLocale(locale, S.trace)}
        </Button>
      </form>

      {parcelId === null ? (
        <ScreenEmptyState
          icon={<Search className="h-6 w-6" />}
          title={pickByLocale(locale, S.promptTitle)}
          description={pickByLocale(locale, S.promptBody)}
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl border border-border" />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="error">
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-medium">{pickByLocale(locale, S.loadFailedTitle)}</p>
              <p className="text-sm">{pickByLocale(locale, S.loadFailedBody)}</p>
            </div>
            <div>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                {pickByLocale(locale, S.retry)}
              </Button>
            </div>
          </div>
        </Alert>
      ) : steps.length === 0 ? (
        <ScreenEmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <>
          <VerificationBadge verification={verification} locale={locale} />
          <ol className="flex flex-col gap-3">
            {steps.map((s) => (
              <StepCard key={s.id} step={s} locale={locale} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function VerificationBadge({
  verification,
  locale,
}: {
  readonly verification: { readonly ok: boolean; readonly brokenAt: number | null } | null;
  readonly locale: Locale;
}) {
  if (!verification) return null;
  if (verification.ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/40 bg-success/5 px-4 py-3 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" />
        {pickByLocale(locale, S.chainVerified)}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <ShieldAlert className="h-4 w-4" />
      {pickByLocale(locale, S.chainBrokenBefore)}
      {verification.brokenAt}
      {pickByLocale(locale, S.chainBrokenAfter)}
    </div>
  );
}

function StepCard({ step, locale }: { readonly step: ChainStep; readonly locale: Locale }) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-border bg-surface/40 p-5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal-500/10 text-xs font-semibold text-signal-500">
        {step.stepIndex}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-eyebrow text-signal-500">
            {chainActionLabels[step.action]
              ? pickByLocale(locale, chainActionLabels[step.action]!)
              : step.action.replace(/_/g, ' ')}
          </span>
          <span className="text-xs text-muted-foreground">
            {`${fmtDateForLocale(step.happenedAt, locale)} · ${fmtTimeForLocale(step.happenedAt, locale)}`}
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground">
          {step.location ?? pickByLocale(locale, S.locationUnrecorded)}
          {step.containerSealNo
            ? ` · ${pickByLocale(locale, S.seal)} ${step.containerSealNo}`
            : ''}
        </p>
        {step.weightGrams ? (
          <p className="text-xs text-muted-foreground">
            {step.weightGrams} g
            {step.gradePct ? ` · ${step.gradePct}%` : ''}
          </p>
        ) : null}
        <p className="mt-2 inline-flex items-center gap-1 text-tiny font-mono text-muted-foreground">
          <LinkIcon className="h-3 w-3" />
          {step.auditHashId.slice(0, 12)}
        </p>
      </div>
    </li>
  );
}
