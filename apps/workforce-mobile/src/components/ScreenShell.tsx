import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack } from 'expo-router'
import { colors } from '../theme/colors'
import { fontSize, spacing } from '../theme/spacing'
import { useI18n } from '../i18n/useI18n'
import { OfflineBanner } from './OfflineBanner'
import type { ReactNode } from 'react'

export interface ScreenShellProps {
  screenId: string
  children?: ReactNode
  contentStyle?: ViewStyle
  scroll?: boolean
}

/**
 * Standard chrome for every catalogue screen: SafeArea + offline banner +
 * header with screen id, localised title and intent. Pure presentational —
 * holds no role logic. Role gating happens in app/(tabs)/_layout.tsx and the
 * per-route guards.
 */
export function ScreenShell({ screenId, children, contentStyle, scroll = true }: ScreenShellProps): JSX.Element {
  const { screen } = useI18n()
  const meta = screen(screenId)

  const body = (
    <View style={[styles.body, contentStyle]}>
      <View style={styles.header}>
        <Text style={styles.badge}>{screenId}</Text>
        <Text style={styles.title}>{meta.title}</Text>
        {meta.intent ? <Text style={styles.intent}>{meta.intent}</Text> : null}
      </View>
      {children}
    </View>
  )

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      <Stack.Screen options={{ title: meta.title, headerShown: false }} />
      <OfflineBanner />
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>{body}</ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.surface
  },
  scrollContent: {
    flexGrow: 1
  },
  body: {
    flex: 1,
    padding: spacing.lg
  },
  header: {
    marginBottom: spacing.lg
  },
  badge: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1
  },
  title: {
    color: colors.text,
    fontSize: fontSize.h1,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  intent: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  }
})
