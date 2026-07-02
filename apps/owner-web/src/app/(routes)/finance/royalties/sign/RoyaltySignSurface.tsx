'use client';

/**
 * O-W-12-SIGN — Royalty batch-sign surface (client).
 *
 * Lists live royalty-return drafts from GET /api/v1/mining/royalty and
 * lets the owner sign each one (POST /api/v1/mining/royalty/:id/sign).
 * Signing FILES + PAYS via LedgerService.post() on the gateway —
 * money never bypasses the ledger (CLAUDE.md hard rule).
 *
 * High-stakes amounts (≥ 5 M in the tenant primary currency) require a
 * four-eye approval token before the gateway accepts the sign. That
 * flow is surfaced as an honest blocker: the row shows "Needs approval"
 * and links to /ask?prompt=four-eye so the owner can request it via
 * Mr. Mwikila.
 *
 * Locale is seeded from the server-resolved value so SSR and the first
 * client render agree (no EN-under-SW first-paint split-brain).
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Clock,
  PenLine,
  Sparkles,
  Users,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button, Skeleton, Alert, Input, Badge } from '@borjie/design-system';
import { localizeApiError } from '@borjie/error-catalog';
import { apiRequest, ApiError } from '@/lib/api-client';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import {
  formatMoney,
  fmtMonthYearForLocale,
  bcp47For,
  LAUNCH_CURRENCY,
} from '@/lib/format';
import { useLocale, type Locale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import { royaltySignPageStrings as SP } from '@/i18n/strings/royalty-sign-page';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const RoyaltyDraftSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  mineral: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  status: z.string(),
  royaltyAmount: z.number().nullable(),
  currency: z.string().nullable(),
  ledgerJournalId: z.string().nullable(),
  signed: z.boolean(),
  createdAt: z.string(),
});

type RoyaltyDraft = z.infer<typeof RoyaltyDraftSchema>;

const ListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    drafts: z.array(RoyaltyDraftSchema),
  }),
  meta: z.object({ count: z.number() }).optional(),
});

// ---------------------------------------------------------------------------
// Query / mutation keys
// ---------------------------------------------------------------------------

const QUERY_KEY = ['mining', 'royalty', 'drafts'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Four-eye approval threshold — the high-stakes ceiling above which the
 * gateway demands a second approver before it accepts a royalty sign.
 *
 * The GATEWAY is the authority (it enforces the policy per the draft's own
 * jurisdiction/currency). This client-side value is the ADVISORY mirror so
 * the row can pre-empt the blocker without a round-trip. It is therefore a
 * regime-movable constant PAIRED with the currency it is denominated in —
 * never a bare magic number. At launch the policy is TZS-denominated, so the
 * amount is paired with `LAUNCH_CURRENCY`; a KE/UG/NG draft renders the same
 * advisory in its own code and the gateway has the final, authoritative say.
 */
const FOUR_EYE_THRESHOLD: {
  readonly amount: number;
  readonly currency: string;
} = {
  amount: 5_000_000,
  currency: LAUNCH_CURRENCY,
};

// The gateway sign route accepts an approved four_eye_requests UUID as the
// second-signatory token. This client-side shape check only gates the submit
// affordance; the gateway re-verifies the row exists AND is 'approved'.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Money render currency is DATA: each draft carries its own ISO-4217 code
// (KE/UG/NG tenants render their own currency). LAUNCH_CURRENCY is only the
// fallback for a legacy draft that predates the currency column — never the
// hardcoded currency for every tenant.
function draftCurrency(draft: RoyaltyDraft): string {
  const code = draft.currency?.trim();
  return code && code.length > 0 ? code : LAUNCH_CURRENCY;
}

// Locale-aware period range — never a hardcoded 'en-GB'. The BCP-47 tag
// follows the user's active locale (locale-follows-the-user canon).
function fmtPeriod(start: string, end: string, locale: Locale): string {
  try {
    const s = fmtMonthYearForLocale(start, locale);
    const e = fmtMonthYearForLocale(end, locale);
    return s === e ? s : `${s} – ${e}`;
  } catch {
    return `${start} – ${end}`;
  }
}

type StatusTone = {
  readonly variant: 'success-soft' | 'warning-soft' | 'secondary';
  readonly icon: React.ElementType;
  readonly label: { readonly en: string; readonly sw: string };
};

function statusTone(draft: RoyaltyDraft): StatusTone {
  if (draft.signed || draft.status === 'submitted') {
    return {
      variant: 'success-soft',
      icon: CheckCircle2,
      label: SP.statusSigned,
    };
  }
  if (draft.status === 'reviewing') {
    return {
      variant: 'warning-soft',
      icon: Clock,
      label: SP.statusReviewing,
    };
  }
  return {
    variant: 'secondary',
    icon: PenLine,
    label: SP.statusDraft,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SignRowForm({
  draft,
  onSigned,
  locale,
}: {
  readonly draft: RoyaltyDraft;
  readonly onSigned: () => void;
  readonly locale: Locale;
}) {
  const [amount, setAmount] = useState<string>(
    draft.royaltyAmount !== null ? String(draft.royaltyAmount) : '',
  );
  const [fourEyeId, setFourEyeId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: {
      royaltyAmount: number;
      confirm: true;
      fourEyeRequestId?: string;
    }) =>
      apiRequest<unknown>(`/api/v1/mining/royalties/${draft.id}/sign`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onSigned();
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof ApiError
          ? localizeApiError(err, locale)
          : SP.errorSignFailed[locale];
      setError(msg);
      setConfirming(false);
    },
  });

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
  const amountValid = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const needsFourEye =
    !Number.isNaN(parsedAmount) && parsedAmount >= FOUR_EYE_THRESHOLD.amount;
  // A four-eye sign completes when the owner supplies the SECOND signatory's
  // approval reference (an approved four_eye_requests id). We accept it as a
  // UUID; the gateway is the authority that re-verifies it is 'approved'
  // before any money moves — the owner can never self-approve.
  const fourEyeIdValid = UUID_RE.test(fourEyeId.trim());
  const canSubmit = needsFourEye
    ? amountValid && fourEyeIdValid
    : amountValid;

  function handleSign() {
    setError(null);
    if (!amountValid) {
      setError(SP.errorEnterValid[locale]);
      return;
    }
    if (needsFourEye && !fourEyeIdValid) {
      setError(
        SP.errorFourEye(
          // The threshold renders in ITS OWN paired currency (the policy
          // amount is denominated in that code), not the draft's.
          formatMoney(FOUR_EYE_THRESHOLD.amount, FOUR_EYE_THRESHOLD.currency, locale),
        )[locale],
      );
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate({
      royaltyAmount: parsedAmount,
      confirm: true,
      ...(needsFourEye ? { fourEyeRequestId: fourEyeId.trim() } : {}),
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`amount-${draft.id}`}
          className="text-xs text-muted-foreground"
        >
          {SP.amountLabel(draftCurrency(draft))[locale]}
        </label>
        <Input
          id={`amount-${draft.id}`}
          type="number"
          inputSize="sm"
          min={0}
          step={1000}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setConfirming(false);
            setError(null);
          }}
          className="w-40 font-mono"
          placeholder={pickByLocale(locale, SP.amountPlaceholder)}
        />
      </div>

      {needsFourEye ? (
        <div className="w-full rounded-xl border border-warning/40 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-warning">
            <Users className="h-3.5 w-3.5" />
            {pickByLocale(locale, SP.fourEyeTitle)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {
              SP.fourEyeExplain(
                formatMoney(
                  FOUR_EYE_THRESHOLD.amount,
                  FOUR_EYE_THRESHOLD.currency,
                  locale,
                ),
              )[locale]
            }
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`four-eye-${draft.id}`}
                className="text-xs text-muted-foreground"
              >
                {pickByLocale(locale, SP.fourEyeApprovalLabel)}
              </label>
              <Input
                id={`four-eye-${draft.id}`}
                inputSize="sm"
                value={fourEyeId}
                onChange={(e) => {
                  setFourEyeId(e.target.value);
                  setConfirming(false);
                  setError(null);
                }}
                className="w-72 font-mono"
                placeholder={pickByLocale(locale, SP.fourEyeApprovalPlaceholder)}
                aria-describedby={`four-eye-hint-${draft.id}`}
              />
              <span
                id={`four-eye-hint-${draft.id}`}
                className="text-tiny text-muted-foreground"
              >
                {pickByLocale(locale, SP.fourEyeApprovalHint)}
              </span>
            </div>

            <Link
              href="/ask?prompt=four-eye"
              className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10"
            >
              <Sparkles className="h-3 w-3" />
              {pickByLocale(locale, SP.requestFourEye)}
            </Link>

            <Button
              type="button"
              size="sm"
              loading={mutation.isPending}
              onClick={handleSign}
              disabled={mutation.isPending || !canSubmit}
              className="gap-1.5"
              leftIcon={<PenLine className="h-3 w-3" />}
            >
              {confirming
                ? pickByLocale(locale, SP.confirmSignAndPay)
                : pickByLocale(locale, SP.signAndPay)}
            </Button>
          </div>

          {!fourEyeIdValid ? (
            <p className="mt-2 text-tiny text-muted-foreground">
              {pickByLocale(locale, SP.fourEyePending)}
            </p>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          loading={mutation.isPending}
          onClick={handleSign}
          disabled={mutation.isPending || !canSubmit}
          className="gap-1.5"
          leftIcon={<PenLine className="h-3 w-3" />}
        >
          {confirming
            ? pickByLocale(locale, SP.confirmSignAndPay)
            : pickByLocale(locale, SP.signAndPay)}
        </Button>
      )}

      {error ? (
        <p className="w-full text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export function RoyaltySignSurface({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const [signedIds, setSignedIds] = useState<ReadonlySet<string>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/mining/royalties', { signal }),
    select: (raw): ReadonlyArray<RoyaltyDraft> => {
      const parsed = ListResponseSchema.safeParse(raw);
      if (!parsed.success) return [];
      return parsed.data.data.drafts;
    },
    staleTime: 30_000,
  });

  const handleSigned = useCallback(
    (id: string) => {
      setSignedIds((prev) => new Set([...prev, id]));
    },
    [],
  );

  const drafts = data ?? [];
  const unsignedDrafts = drafts.filter(
    (d) => !d.signed && d.status !== 'submitted',
  );
  const signedDrafts = drafts.filter(
    (d) => d.signed || d.status === 'submitted',
  );

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Back navigation */}
      <div>
        <Link
          href="/finance"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {pickByLocale(locale, SP.backToFinance)}
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <Calculator className="h-3.5 w-3.5" />
          <span>{pickByLocale(locale, SP.eyebrow)}</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          {pickByLocale(locale, SP.pageTitle)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {pickByLocale(locale, SP.pageIntro)}
        </p>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 rounded-2xl border border-border" />
          <Skeleton className="h-24 rounded-2xl border border-border" />
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <Alert variant="error">
          {pickByLocale(locale, SP.loadError)}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => void refetch()}
            className="ml-2 h-auto p-0 text-xs underline hover:no-underline"
          >
            {pickByLocale(locale, SP.retry)}
          </Button>
        </Alert>
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && drafts.length === 0 ? (
        <ScreenEmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title={pickByLocale(locale, SP.emptyTitle)}
          description={pickByLocale(locale, SP.emptyBody)}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/ask?prompt=royalty+draft" className="gap-1.5">
                <Sparkles className="h-3 w-3" />
                {pickByLocale(locale, SP.emptyCta)}
              </Link>
            </Button>
          }
        />
      ) : null}

      {/* Unsigned drafts */}
      {unsignedDrafts.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {SP.pendingSignature(unsignedDrafts.length)[locale]}
          </h2>
          <ul className="space-y-3">
            {unsignedDrafts.map((draft) => {
              const tone = statusTone(draft);
              const Icon = tone.icon;
              const justSigned = signedIds.has(draft.id);
              return (
                <li
                  key={draft.id}
                  className="rounded-2xl border border-border bg-surface/40 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {draft.mineral}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fmtPeriod(draft.periodStart, draft.periodEnd, locale)}
                        {draft.quantity !== null && draft.unit
                          ? ` · ${draft.quantity.toLocaleString(bcp47For(locale))} ${draft.unit}`
                          : ''}
                      </p>
                    </div>
                    <Badge
                      variant={justSigned ? 'success-soft' : tone.variant}
                      className="gap-1.5"
                    >
                      {justSigned ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <Icon className="h-3 w-3" />
                      )}
                      {justSigned
                        ? pickByLocale(locale, SP.statusSigned)
                        : pickByLocale(locale, tone.label)}
                    </Badge>
                  </div>

                  {!justSigned ? (
                    <SignRowForm
                      draft={draft}
                      onSigned={() => handleSigned(draft.id)}
                      locale={locale}
                    />
                  ) : (
                    <p className="mt-3 text-xs text-success">
                      {SP.signedPosted[locale]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Signed drafts (read-only) */}
      {signedDrafts.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            {SP.alreadySigned(signedDrafts.length)[locale]}
          </h2>
          <ul className="space-y-2">
            {signedDrafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {draft.mineral}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtPeriod(draft.periodStart, draft.periodEnd, locale)}
                    {draft.royaltyAmount !== null
                      ? ` · ${formatMoney(draft.royaltyAmount, draftCurrency(draft), locale)}`
                      : ''}
                  </p>
                </div>
                <Badge variant="success-soft" className="gap-1.5">
                  <CheckCircle2 className="h-3 w-3" />
                  {SP.submitted[locale]}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
