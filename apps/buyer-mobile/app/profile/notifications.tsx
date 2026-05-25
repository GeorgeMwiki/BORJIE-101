import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { PrimaryButton } from '@/components/PrimaryButton'
import { useToast } from '@/components/Toast'
import { useTranslation } from '@/hooks/useTranslation'
import { updateNotificationPrefs, type NotificationPrefs } from '@/api/buyers'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

interface ToggleConfig {
  readonly key: keyof NotificationPrefs
  readonly i18nKey: string
  readonly defaultValue: boolean
}

const toggles: readonly ToggleConfig[] = [
  { key: 'newListings', i18nKey: 'profile.notif_new_listings', defaultValue: true },
  { key: 'bidUpdates', i18nKey: 'profile.notif_bid_updates', defaultValue: true },
  { key: 'documentReady', i18nKey: 'profile.notif_document_ready', defaultValue: true },
  { key: 'priceAlerts', i18nKey: 'profile.notif_price_alerts', defaultValue: false }
] as const

function initialState(): NotificationPrefs {
  return toggles.reduce<NotificationPrefs>(
    (acc, item) => ({ ...acc, [item.key]: item.defaultValue }),
    { newListings: true, bidUpdates: true, documentReady: true, priceAlerts: false }
  )
}

export default function ProfileNotifications() {
  const { t } = useTranslation()
  const toast = useToast()
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => initialState())

  const saveMutation = useMutation({
    mutationFn: updateNotificationPrefs,
    onSuccess: () => toast.show(t('profile.notifications_saved'), 'success'),
    onError: () => toast.show(t('profile.save_failed'), 'error')
  })

  return (
    <Screen>
      <SectionHeader title={t('profile.notifications_title')} />

      {toggles.map((item) => (
        <Card key={item.key}>
          <View style={styles.row}>
            <Text style={styles.label}>{t(item.i18nKey)}</Text>
            <Switch
              value={prefs[item.key]}
              onValueChange={(next) => setPrefs((prev) => ({ ...prev, [item.key]: next }))}
              trackColor={{ true: colors.forest, false: colors.line }}
            />
          </View>
        </Card>
      ))}

      <View style={{ marginTop: spacing.md }}>
        <PrimaryButton
          label={t('profile.save')}
          onPress={() => saveMutation.mutate(prefs)}
          disabled={saveMutation.isPending}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1, paddingRight: spacing.md }
})
