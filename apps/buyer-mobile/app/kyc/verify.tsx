import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { Pill, PillTone } from '@/components/Pill'
import { useTranslation } from '@/hooks/useTranslation'
import { getCurrentUser } from '@/auth/session'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

interface Check {
  readonly key: string
  readonly status: 'approved' | 'pending' | 'rejected'
}

const checks: readonly Check[] = [
  { key: 'kyc.step_nida', status: 'approved' },
  { key: 'kyc.step_tin', status: 'approved' },
  { key: 'kyc.step_company', status: 'pending' },
  { key: 'kyc.step_aml', status: 'pending' }
] as const

const toneByStatus: Record<Check['status'], PillTone> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger'
}

export default function KycVerify() {
  const { t } = useTranslation()
  const user = getCurrentUser()

  return (
    <Screen>
      <SectionHeader
        title={t('kyc.title')}
        subtitle={`${user.companyName} · ${user.countryCode}`}
      />

      {checks.map((check) => (
        <Card key={check.key}>
          <View style={styles.row}>
            <Text style={styles.label}>{t(check.key)}</Text>
            <Pill label={t(`kyc.status_${check.status}`)} tone={toneByStatus[check.status]} />
          </View>
        </Card>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.bodyStrong, color: colors.ink }
})
