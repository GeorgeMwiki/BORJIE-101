import { StyleSheet, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useAuth } from '../auth/useAuth'
import { canSee } from '../roles/access'
import { colors } from '../theme/colors'
import { fontSize, spacing } from '../theme/spacing'
import type { ReactNode } from 'react'

export interface RoleGuardProps {
  screenId: string
  children: ReactNode
}

/**
 * Route-level role check. If the current user has no role yet we send them
 * to the dev role picker. If the role isn't permitted to see the screen we
 * render a polite forbidden card so debugging is easy.
 */
export function RoleGuard({ screenId, children }: RoleGuardProps): JSX.Element {
  const { user, ready } = useAuth()

  if (!ready) {
    return <View style={styles.bg} />
  }
  if (!user) {
    return <Redirect href="/onboarding/role" />
  }
  if (!canSee(screenId, user.role)) {
    return (
      <View style={styles.forbidden}>
        <Text style={styles.code}>{screenId}</Text>
        <Text style={styles.title}>Hauruhusiwi</Text>
        <Text style={styles.message}>
          Skrini hii inaonekana kwa {accessLabel(screenId)} pekee.
        </Text>
      </View>
    )
  }
  return <>{children}</>
}

function accessLabel(screenId: string): string {
  if (screenId.startsWith('O-M-')) {
    return 'mmiliki / meneja'
  }
  return 'mfanyakazi / meneja'
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: colors.surface
  },
  forbidden: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    justifyContent: 'center'
  },
  code: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm
  },
  title: {
    color: colors.text,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  message: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: fontSize.body
  }
})
