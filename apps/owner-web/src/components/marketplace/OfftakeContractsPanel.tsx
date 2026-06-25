'use client';

import { useMemo, useState } from 'react';
import { FileSignature, PenLine, ScrollText } from 'lucide-react';
import { Alert, Button, Skeleton, StatusBadge } from '@borjie/design-system';
import {
  useOfftakeAgreements,
  useSignOfftake,
  type OfftakeAgreement,
} from '@/lib/queries/marketplace';
import { localizeError } from '@/lib/api-client';
import { fmtDateForLocale, fmtNum, formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { pickByLocale, type Locale } from '@/lib/locale';
import { marketplaceSellerStrings as S } from '@/i18n/strings/marketplace-seller';

interface OfftakeContractsPanelProps {
  readonly locale: Locale;
}

/**
 * Seller leg — the binding offtake-contract ledger.
 *
 * COMPLETION-LAW: the gateway crystallizes a binding offtake agreement the
 * moment a seller accepts a bid (GET /api/v1/mining/bids/offtake-agreements
 * lists them, tenant-scoped). This panel surfaces those contracts split by
 * lifecycle — `pending_signature` (awaiting signature) vs `signed` (and
 * terminal) — so the owner sees what is binding vs what still needs a
 * signature. CONTRACT-TERM money only (never a ledger figure). All states
 * render; every string resolves to the active locale only (zero-mix).
 */
export function OfftakeContractsPanel({
  locale,
}: OfftakeContractsPanelProps): JSX.Element {
  const query = useOfftakeAgreements();
  const contracts = query.data ?? [];

  // COMPLETION-LAW sign leg. Track WHICH row is signing (the mutation is
  // single-flight) and the localized error keyed by agreement id so a failed
  // signature surfaces a recoverable, single-locale message on the affected
  // row — never a silent no-op, never a raw English string.
  const signMutation = useSignOfftake();
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signError, setSignError] = useState<{
    readonly id: string;
    readonly message: string;
  } | null>(null);

  const handleSign = (agreementId: string): void => {
    setSignError(null);
    setSigningId(agreementId);
    signMutation.mutate(agreementId, {
      onSuccess: () => {
        setSigningId(null);
      },
      onError: (err: unknown) => {
        setSigningId(null);
        setSignError({ id: agreementId, message: localizeError(err, locale) });
      },
    });
  };

  const metrics = useMemo<readonly MetricTile[]>(() => {
    if (contracts.length === 0) return [];
    const pending = contracts.filter(
      (c) => c.status === 'pending_signature',
    ).length;
    const signed = contracts.filter((c) => c.status === 'signed').length;
    return [
      {
        label: pickByLocale(locale, S.offtakeStatusPendingSignature),
        value: String(pending),
        icon: FileSignature,
        tone: pending > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: pickByLocale(locale, S.offtakeStatusSigned),
        value: String(signed),
        icon: ScrollText,
        tone: signed > 0 ? ('success' as const) : ('default' as const),
      },
    ];
  }, [contracts, locale]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">
          {pickByLocale(locale, S.offtakeTitle)}
        </h2>
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.offtakeSubtitle)}
        </p>
      </header>

      {query.isPending ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl border border-border" />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="px-5 py-6 text-sm text-destructive">
          {pickByLocale(locale, S.offtakeLoadError)}
        </div>
      ) : contracts.length === 0 ? (
        <div className="px-5 py-6">
          <ScreenEmptyState
            icon={<FileSignature className="h-6 w-6" />}
            title={pickByLocale(locale, S.offtakeEmptyTitle)}
            description={pickByLocale(locale, S.offtakeEmptyBody)}
          />
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4">
          {metrics.length > 0 ? <MetricStrip tiles={metrics} cols={2} /> : null}
          <ul className="divide-y divide-border/60 rounded-xl border border-border">
            {contracts.map((c) => (
              <OfftakeRow
                key={c.id}
                contract={c}
                locale={locale}
                onSign={handleSign}
                signing={signingId === c.id}
                signDisabled={signingId !== null}
                errorMessage={signError?.id === c.id ? signError.message : null}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OfftakeRow({
  contract,
  locale,
  onSign,
  signing,
  signDisabled,
  errorMessage,
}: {
  readonly contract: OfftakeAgreement;
  readonly locale: Locale;
  readonly onSign: (agreementId: string) => void;
  readonly signing: boolean;
  readonly signDisabled: boolean;
  readonly errorMessage: string | null;
}): JSX.Element {
  const canSign = contract.status === 'pending_signature';
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground">
          <span className="font-mono font-semibold">
            {formatMoney(contract.agreedPriceTzs, LAUNCH_CURRENCY, locale)}
          </span>
          <span className="text-xs text-muted-foreground">
            {pickByLocale(locale, S.offtakeQuantityLabel)}:{' '}
            {fmtNum(contract.quantityKg)}{' '}
            {pickByLocale(locale, S.offtakeQuantityUnit)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {contract.paymentTerms ? (
            <span>
              {pickByLocale(locale, S.offtakePaymentTermsLabel)}:{' '}
              {contract.paymentTerms}
            </span>
          ) : null}
          {contract.createdAt ? (
            <span>
              {pickByLocale(locale, S.offtakeCreatedLabel)}:{' '}
              {fmtDateForLocale(contract.createdAt, locale)}
            </span>
          ) : null}
        </div>
        {errorMessage ? (
          <Alert variant="error" className="mt-2 text-xs">
            {errorMessage}
          </Alert>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <OfftakeStatusBadge status={contract.status} locale={locale} />
        {canSign ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={signing}
            disabled={signDisabled}
            leftIcon={<PenLine className="h-3.5 w-3.5" />}
            onClick={() => onSign(contract.id)}
          >
            {signing
              ? pickByLocale(locale, S.offtakeSigningLabel)
              : pickByLocale(locale, S.offtakeSignButton)}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Map an offtake status enum token → a localized label + DS badge tone. */
function OfftakeStatusBadge({
  status,
  locale,
}: {
  readonly status: OfftakeAgreement['status'];
  readonly locale: Locale;
}): JSX.Element {
  switch (status) {
    case 'signed':
      return (
        <StatusBadge status="success">
          {pickByLocale(locale, S.offtakeStatusSigned)}
        </StatusBadge>
      );
    case 'cancelled':
      return (
        <StatusBadge status="error">
          {pickByLocale(locale, S.offtakeStatusCancelled)}
        </StatusBadge>
      );
    case 'completed':
      return (
        <StatusBadge status="active">
          {pickByLocale(locale, S.offtakeStatusCompleted)}
        </StatusBadge>
      );
    case 'pending_signature':
    default:
      return (
        <StatusBadge status="pending">
          {pickByLocale(locale, S.offtakeStatusPendingSignature)}
        </StatusBadge>
      );
  }
}
