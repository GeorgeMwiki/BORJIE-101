/**
 * Buyer-side binding offtake-contract card — the COMPLETION-LAW leg.
 *
 * When a seller accepts the buyer's bid, the gateway crystallizes a binding
 * offtake contract (`offtake_agreements`). The owner sees it in the cockpit's
 * `OfftakeContractsPanel`; this is the buyer's mirror surface: agreed price,
 * agreed quantity, payment terms, lifecycle status, and the date the contract
 * was struck. Same row shape as the owner panel, rendered as a mobile card.
 *
 * All states render (loading / error / empty / present). Every string resolves
 * through `t()` to the active locale only — zero-mix. The load error is
 * localized by error code (network vs generic).
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { Pill, type PillTone } from '@/components/Pill'
import { formatDate, formatKg, formatTzs } from '@/components/formatters'
import { useTranslation } from '@/hooks/useTranslation'
import { isNetworkError } from '@/api/errors'
import type { OfftakeAgreement, OfftakeStatus } from '@/api/offtake'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

const toneByStatus: Record<OfftakeStatus, PillTone> = {
  pending_signature: 'warning',
  signed: 'success',
  completed: 'gold',
  cancelled: 'danger',
}

/** Localized payment-terms label — falls back to the raw snapshot value. */
function paymentTermsLabel(
  raw: string,
  t: (path: string) => string,
): string {
  switch (raw) {
    case 'instant':
      return t('bids.payment_instant')
    case 'net_30':
      return t('bids.payment_30')
    case 'net_60':
      return t('bids.payment_60')
    default:
      return raw
  }
}

export interface OfftakeContractCardProps {
  readonly contract: OfftakeAgreement | null | undefined
  readonly isLoading: boolean
  readonly isError: boolean
  readonly error: unknown
}

export function OfftakeContractCard({
  contract,
  isLoading,
  isError,
  error,
}: OfftakeContractCardProps): JSX.Element {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <Card>
        <Text style={styles.title}>{t('bids.offtake.title')}</Text>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={t('bids.offtake.loading')}
          style={styles.loader}
        >
          <ActivityIndicator color={colors.gold} />
        </View>
      </Card>
    )
  }

  if (isError) {
    const message = isNetworkError(error)
      ? t('bids.offtake.error_network')
      : t('bids.offtake.load_failed')
    return (
      <Card>
        <Text style={styles.title}>{t('bids.offtake.title')}</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {message}
        </Text>
      </Card>
    )
  }

  if (!contract) {
    return (
      <Card>
        <Text style={styles.title}>{t('bids.offtake.title')}</Text>
        <Text style={styles.empty}>{t('bids.offtake.empty')}</Text>
      </Card>
    )
  }

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>{t('bids.offtake.title')}</Text>
        <Pill
          label={t(`bids.offtake.status.${contract.status}`)}
          tone={toneByStatus[contract.status]}
        />
      </View>
      <Text style={styles.subtitle}>{t('bids.offtake.subtitle')}</Text>

      <View style={styles.body}>
        <KeyValueRow
          label={t('bids.offtake.agreed_price')}
          value={`${formatTzs(contract.agreedPriceTzs)} / ${t('common.kg')}`}
        />
        <KeyValueRow
          label={t('bids.offtake.quantity')}
          value={formatKg(contract.quantityKg)}
        />
        {contract.paymentTerms ? (
          <KeyValueRow
            label={t('bids.offtake.payment_terms')}
            value={paymentTermsLabel(contract.paymentTerms, t)}
          />
        ) : null}
        {contract.createdAt ? (
          <KeyValueRow
            label={t('bids.offtake.created')}
            value={formatDate(contract.createdAt)}
          />
        ) : null}
        {contract.signedAt ? (
          <KeyValueRow
            label={t('bids.offtake.signed_at')}
            value={formatDate(contract.signedAt)}
          />
        ) : null}
      </View>

      {contract.status === 'pending_signature' ? (
        <Text style={styles.note}>{t('bids.offtake.awaiting_signature')}</Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { ...typography.heading, color: colors.ink, flexShrink: 1 },
  subtitle: {
    ...typography.caption,
    color: colors.inkMuted,
    marginTop: spacing.xs,
  },
  body: { marginTop: spacing.sm },
  loader: { paddingVertical: spacing.lg, alignItems: 'center' },
  error: { ...typography.body, color: colors.danger, marginTop: spacing.sm },
  empty: { ...typography.body, color: colors.inkMuted, marginTop: spacing.sm },
  note: {
    ...typography.caption,
    color: colors.inkMuted,
    marginTop: spacing.md,
  },
})
