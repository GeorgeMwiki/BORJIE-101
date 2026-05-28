import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import type { ReactNode } from 'react'

export interface WizardShellProps {
  badge: string
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  contentStyle?: ViewStyle
  scroll?: boolean
}

/**
 * Lightweight chrome for every onboarding step. Mirrors the look of
 * `ScreenShell` but without OfflineBanner / role-aware screen catalogue
 * coupling — the wizard runs before a user has a role.
 */
export function WizardShell({
  badge,
  title,
  subtitle,
  children,
  footer,
  contentStyle,
  scroll = true
}: WizardShellProps): JSX.Element {
  const body = (
    <View style={[styles.body, contentStyle]}>
      <View style={styles.header}>
        <Text style={styles.badge}>{badge}</Text>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  )
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.earth800
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl
  },
  body: {
    flex: 1,
    padding: spacing.lg
  },
  header: {
    marginBottom: spacing.lg
  },
  badge: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase'
  },
  title: {
    color: colors.text,
    fontSize: fontSize.h1,
    fontWeight: '700',
    marginTop: spacing.xs,
    letterSpacing: -0.6
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    lineHeight: fontSize.body * 1.5
  },
  content: {
    marginTop: spacing.md
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: colors.earth700,
    gap: spacing.sm
  }
})
