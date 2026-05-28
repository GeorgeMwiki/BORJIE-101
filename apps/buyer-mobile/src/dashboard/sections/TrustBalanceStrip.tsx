import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/Card'
import { Pill, type PillTone } from '@/components/Pill'
import { tokens } from '@/ui-litfin'
import type { BuyerUser } from '@/types/auth'

export interface TrustBalanceStripProps {
  readonly user: BuyerUser
  readonly translate: (key: string) => string
}

const TONE_BY_KYC: Readonly<Record<BuyerUser['kycStatus'], PillTone>> = {
  pending: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger'
}

const LABEL_BY_KYC: Readonly<Record<BuyerUser['kycStatus'], string>> = {
  pending: 'kyc.status_pending',
  submitted: 'kyc.status_pending',
  approved: 'kyc.status_approved',
  rejected: 'kyc.status_rejected'
}

export function TrustBalanceStrip({ user, translate }: TrustBalanceStripProps) {
  const tone = TONE_BY_KYC[user.kycStatus]
  const labelKey = LABEL_BY_KYC[user.kycStatus]
  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.identity}>
          <Text style={styles.company} numberOfLines={1}>
            {user.companyName || translate('profile.company')}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {user.phone}
          </Text>
        </View>
        <Pill label={translate(labelKey)} tone={tone} />
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  identity: { flexShrink: 1, paddingRight: tokens.space.md },
  company: { ...tokens.type.bodyStrong, color: tokens.color.textPrimary },
  meta: { ...tokens.type.bodySm, color: tokens.color.textMuted, marginTop: 2 }
})
