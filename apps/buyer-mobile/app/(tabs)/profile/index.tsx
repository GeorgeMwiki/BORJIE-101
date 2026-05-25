import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { KeyValueRow } from '@/components/KeyValueRow'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useTranslation } from '@/hooks/useTranslation'
import { getCurrentUser } from '@/auth/session'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

export default function ProfileIndex() {
  const router = useRouter()
  const { t } = useTranslation()
  const user = getCurrentUser()

  return (
    <Screen>
      <SectionHeader title={t('profile.title')} subtitle={user.companyName} />

      <Card>
        <KeyValueRow label={t('profile.company')} value={user.companyName} />
        <KeyValueRow label={t('profile.phone')} value={user.phone} />
        <KeyValueRow label={t('profile.country')} value={user.countryCode} />
        <KeyValueRow label={t('profile.language')} value={user.preferredLang.toUpperCase()} />
      </Card>

      <Card onPress={() => router.push('/profile/notifications')}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.notifications')}</Text>
          <Text style={styles.rowChevron}>›</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>{t('profile.payment_methods')}</Text>
        <KeyValueRow label="M-Pesa" value="+255 712 *** 001" />
        <KeyValueRow label="NMB Bank" value="**** 4421" />
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <PrimaryButton label={t('profile.logout')} variant="ghost" onPress={() => router.replace('/auth/login')} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...typography.bodyStrong, color: colors.ink },
  rowChevron: { ...typography.title, color: colors.inkMuted },
  cardTitle: { ...typography.heading, color: colors.ink, marginBottom: spacing.sm }
})
