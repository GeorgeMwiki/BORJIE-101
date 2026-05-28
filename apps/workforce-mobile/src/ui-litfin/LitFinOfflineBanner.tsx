import { StyleSheet, Text, View } from 'react-native'
import { tokens } from './tokens'

export interface LitFinOfflineBannerProps {
  readonly visible: boolean
  readonly label: string
  readonly subtitle?: string
  readonly testID?: string
}

/**
 * LitFin offline banner — slim amber pill anchored under the
 * navigation. Shown when the offline cache is the truth source.
 */
export function LitFinOfflineBanner({
  visible,
  label,
  subtitle,
  testID
}: LitFinOfflineBannerProps): JSX.Element | null {
  if (!visible) {
    return null
  }
  return (
    <View testID={testID} style={styles.wrap}>
      <View style={styles.dot} />
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    backgroundColor: 'rgba(255, 200, 87, 0.10)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 200, 87, 0.32)'
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.color.gold
  },
  copy: {
    flex: 1
  },
  label: {
    ...tokens.type.bodySmStrong,
    color: tokens.color.gold
  },
  sub: {
    ...tokens.type.micro,
    color: tokens.color.textSecondary,
    marginTop: 2
  }
})
