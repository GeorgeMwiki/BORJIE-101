import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import Constants from 'expo-constants'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { ALL_ROLES, type Role } from '../../src/roles/types'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

export default function RolePicker(): JSX.Element {
  const { t } = useI18n()
  const { setRole } = useAuth()
  const tagline = (Constants.expoConfig?.extra?.['splashTagline'] as string | undefined) ?? 'Borjie · Ofisi ya Mgodi'

  function choose(role: Role): void {
    setRole(role)
    router.replace('/(tabs)/home')
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.brand}>
        <Text style={styles.brandText}>{tagline}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{t.roles.title}</Text>
        <Text style={styles.subtitle}>{t.roles.subtitle}</Text>
        <View style={styles.list}>
          {ALL_ROLES.map((role) => (
            <Pressable
              key={role}
              accessibilityRole="button"
              onPress={() => choose(role)}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            >
              <Text style={styles.cardLabel}>{labelFor(role, t)}</Text>
              <Text style={styles.cardCaption}>{role.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

function labelFor(role: Role, t: ReturnType<typeof useI18n>['t']): string {
  switch (role) {
    case 'owner':
      return t.roles.owner
    case 'manager':
      return t.roles.manager
    case 'employee':
      return t.roles.employee
    default:
      return role
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.earth700
  },
  brand: {
    alignItems: 'center',
    paddingVertical: spacing.xl
  },
  brandText: {
    color: colors.goldLight,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  body: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl
  },
  title: {
    color: colors.text,
    fontSize: fontSize.h1,
    fontWeight: '700'
  },
  subtitle: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontSize: fontSize.body
  },
  list: {
    marginTop: spacing.xl,
    gap: spacing.md
  },
  card: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.earth100,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardPressed: {
    backgroundColor: colors.earth300
  },
  cardLabel: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700'
  },
  cardCaption: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
    letterSpacing: 1
  }
})
