import { useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/SectionHeader'
import { Card } from '@/components/Card'
import { useTranslation } from '@/hooks/useTranslation'
import { colors } from '@/theme/colors'
import { spacing, typography } from '@/theme/spacing'

interface NotifToggle {
  readonly key: string
  readonly defaultValue: boolean
}

const toggles: readonly NotifToggle[] = [
  { key: 'profile.notif_new_listings', defaultValue: true },
  { key: 'profile.notif_bid_updates', defaultValue: true },
  { key: 'profile.notif_document_ready', defaultValue: true },
  { key: 'profile.notif_price_alerts', defaultValue: false }
] as const

export default function ProfileNotifications() {
  const { t } = useTranslation()
  const [state, setState] = useState<Record<string, boolean>>(() =>
    toggles.reduce<Record<string, boolean>>((acc, item) => ({ ...acc, [item.key]: item.defaultValue }), {})
  )

  return (
    <Screen>
      <SectionHeader title={t('profile.notifications_title')} />

      {toggles.map((item) => (
        <Card key={item.key}>
          <View style={styles.row}>
            <Text style={styles.label}>{t(item.key)}</Text>
            <Switch
              value={state[item.key] ?? false}
              onValueChange={(next) => setState((prev) => ({ ...prev, [item.key]: next }))}
              trackColor={{ true: colors.forest, false: colors.line }}
            />
          </View>
        </Card>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1, paddingRight: spacing.md }
})
