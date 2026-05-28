import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack } from 'expo-router'
import { useI18n } from '../i18n/useI18n'
import { OfflineBanner } from './OfflineBanner'
import { tokens } from '../ui-litfin'
import type { ReactNode } from 'react'

export interface ScreenShellProps {
  screenId: string
  children?: ReactNode
  contentStyle?: ViewStyle
  scroll?: boolean
}

/**
 * Standard chrome for every catalogue screen: SafeArea + offline banner +
 * LitFin-styled header with screen id eyebrow + display title + intent.
 * Pure presentational — holds no role logic. Role gating happens in
 * `app/(tabs)/_layout.tsx` and the per-route guards.
 *
 * Palette: LitFin navy-slate ground with cream type + gold eyebrow, so
 * the foundation matches the marketing site and owner-web shell.
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
    backgroundColor: tokens.color.bgSurface
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: tokens.space.xxxl
  },
  body: {
    flex: 1,
    padding: tokens.space.lg
  },
  header: {
    marginBottom: tokens.space.lg
  },
  badge: {
    ...tokens.type.eyebrow,
    color: tokens.color.gold
  },
  title: {
    ...tokens.type.h1,
    color: tokens.color.textPrimary,
    marginTop: tokens.space.xs
  },
  intent: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.xs
  }
})
