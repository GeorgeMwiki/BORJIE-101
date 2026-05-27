import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill, PillTone } from '@/components/Pill'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'
import { KycStatusResultSchema } from '../toolPayloads'

export interface TrustBalanceStripCardProps {
  readonly payload: unknown
  readonly translate: (key: string) => string
}

// Renders kyc.status tool output as a compact trust strip. The strip
// doubles as the buyer's "balance" indicator until a real escrow balance
// endpoint ships — we display the KYC stage as the limiting factor.

const STATUS_TONE: Readonly<Record<string, PillTone>> = {
  approved: 'success',
  submitted: 'warning',
  pending: 'neutral',
  rejected: 'danger'
}

export function TrustBalanceStripCard({ payload, translate }: TrustBalanceStripCardProps) {
  const parsed = KycStatusResultSchema.safeParse(payload)
  if (!parsed.success) {
    return null
  }
  const { status, message } = parsed.data
  const tone = STATUS_TONE[status] ?? 'neutral'
  const labelKey =
    status === 'approved'
      ? 'kyc.status_approved'
      : status === 'rejected'
        ? 'kyc.status_rejected'
        : 'kyc.status_pending'
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.label}>{translate('kyc.verify_title')}</Text>
        <Pill label={translate(labelKey)} tone={tone} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.bodyStrong, color: colors.ink },
  message: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm }
})
