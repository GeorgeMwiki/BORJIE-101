'use client';

/**
 * O-W-12-SIGN — Royalty batch-sign surface.
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
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Clock,
  Loader2,
  PenLine,
  Sparkles,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import { fmtTzs } from '@/lib/format';

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

const FOUR_EYE_THRESHOLD = 5_000_000;

function fmtPeriod(start: string, end: string): string {
  try {
    const s = new Date(start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    const e = new Date(end).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return s === e ? s : `${s} – ${e}`;
  } catch {
    return `${start} – ${end}`;
  }
}

type StatusTone = {
  readonly pillClass: string;
  readonly icon: React.ElementType;
  readonly label: string;
};

function statusTone(draft: RoyaltyDraft): StatusTone {
  if (draft.signed || draft.status === 'submitted') {
    return {
      pillClass: 'border-success/40 bg-success/10 text-success',
      icon: CheckCircle2,
      label: 'Signed',
    };
  }
  if (draft.status === 'reviewing') {
    return {
      pillClass: 'border-warning/40 bg-warning/10 text-warning',
      icon: Clock,
      label: 'Reviewing',
    };
  }
  return {
    pillClass: 'border-border bg-surface text-neutral-300',
    icon: PenLine,
    label: 'Draft',
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SignRowForm({
  draft,
  onSigned,
}: {
  readonly draft: RoyaltyDraft;
  readonly onSigned: () => void;
}) {
  const [amount, setAmount] = useState<string>(
    draft.royaltyAmount !== null ? String(draft.royaltyAmount) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: { royaltyAmount: number; confirm: true }) =>
      apiRequest<unknown>(`/api/v1/mining/royalty/${draft.id}/sign`, {
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
          ? err.message
          : 'Sign failed. Please try again.';
      setError(msg);
      setConfirming(false);
    },
  });

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
  const needsFourEye =
    !Number.isNaN(parsedAmount) && parsedAmount >= FOUR_EYE_THRESHOLD;
  const canSubmit = !Number.isNaN(parsedAmount) && parsedAmount > 0 && !needsFourEye;

  function handleSign() {
    setError(null);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a valid royalty amount before signing.');
      return;
    }
    if (needsFourEye) {
      setError(
        `Amounts ≥ ${fmtTzs(FOUR_EYE_THRESHOLD)} require a four-eye approval. Use "Ask Mr. Mwikila" to request one.`,
      );
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate({ royaltyAmount: parsedAmount, confirm: true });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`amount-${draft.id}`}
          className="text-xs text-neutral-400"
        >
          Amount (TZS)
        </label>
        <input
          id={`amount-${draft.id}`}
          type="number"
          min={0}
          step={1000}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setConfirming(false);
            setError(null);
          }}
          className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/50"
          placeholder="0"
        />
      </div>

      {needsFourEye ? (
        <Link
          href="/ask?prompt=four-eye"
          className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10"
        >
          <Sparkles className="h-3 w-3" />
          Request four-eye approval
        </Link>
      ) : (
        <button
          type="button"
          onClick={handleSign}
          disabled={mutation.isPending || !canSubmit}
          className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-3 py-1.5 text-xs font-semibold text-background hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <PenLine className="h-3 w-3" />
          )}
          {confirming ? 'Confirm sign & pay' : 'Sign & pay'}
        </button>
      )}

      {error ? (
        <p className="w-full text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RoyaltySignPage() {
  const [signedIds, setSignedIds] = useState<ReadonlySet<string>>(new Set());

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/mining/royalty', { signal }),
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
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Finance
        </Link>
      </div>

      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
          <Calculator className="h-3.5 w-3.5" />
          <span>Finance · Royalty</span>
        </div>
        <h1 className="font-display text-2xl font-medium text-foreground">
          Batch royalty sign
        </h1>
        <p className="text-sm text-neutral-400">
          Review each draft, enter the royalty amount, and sign to file +
          post the payment via the double-entry ledger.
        </p>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading drafts…
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-sm text-destructive">
            Could not load royalty drafts from the gateway.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 text-xs text-destructive underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && drafts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface/40 p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
          <p className="mt-3 text-sm font-medium text-foreground">
            No royalty drafts pending
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            New drafts appear here when Mr. Mwikila prepares the monthly royalty
            return.
          </p>
          <Link
            href="/ask?prompt=royalty+draft"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3 w-3" />
            Ask Mr. Mwikila to prepare a draft
          </Link>
        </div>
      ) : null}

      {/* Unsigned drafts */}
      {unsignedDrafts.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Pending signature ({unsignedDrafts.length})
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
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {fmtPeriod(draft.periodStart, draft.periodEnd)}
                        {draft.quantity !== null && draft.unit
                          ? ` · ${draft.quantity.toLocaleString()} ${draft.unit}`
                          : ''}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-badge font-medium ${tone.pillClass}`}
                    >
                      <Icon className="h-3 w-3" />
                      {justSigned ? 'Signed' : tone.label}
                    </span>
                  </div>

                  {!justSigned ? (
                    <SignRowForm
                      draft={draft}
                      onSigned={() => handleSigned(draft.id)}
                    />
                  ) : (
                    <p className="mt-3 text-xs text-success">
                      Signed and posted to ledger.
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
          <h2 className="mb-3 text-sm font-semibold text-neutral-400">
            Already signed ({signedDrafts.length})
          </h2>
          <ul className="space-y-2">
            {signedDrafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface/40 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-neutral-300">
                    {draft.mineral}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {fmtPeriod(draft.periodStart, draft.periodEnd)}
                    {draft.royaltyAmount !== null
                      ? ` · ${fmtTzs(draft.royaltyAmount)}`
                      : ''}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-badge font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  Submitted
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
