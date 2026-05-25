import { StyleSheet, Text, View } from 'react-native'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import { useQueueSize } from '../sync/useQueueSize'
import { useI18n } from '../i18n/useI18n'
import { colors } from '../theme/colors'
import { spacing, fontSize } from '../theme/spacing'

export function OfflineBanner(): JSX.Element | null {
  const { online } = useOnlineStatus()
  const queueSize = useQueueSize()
  const { t } = useI18n()

  if (online && queueSize === 0) {
    return null
  }

  const message = online
    ? `${t.app.online} · ${queueSize}`
    : `${t.app.offline} · ${queueSize}`

  return (
    <View
      style={[styles.banner, online ? styles.bannerOnline : styles.bannerOffline]}
      accessibilityRole="alert"
    >
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center'
  },
  bannerOnline: {
    backgroundColor: colors.online
  },
  bannerOffline: {
    backgroundColor: colors.offline
  },
  text: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '600'
  }
})
