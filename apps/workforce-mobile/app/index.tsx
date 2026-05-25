import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import Constants from 'expo-constants'
import { useAuth } from '../src/auth/useAuth'
import { colors } from '../src/theme/colors'
import { fontSize, spacing } from '../src/theme/spacing'

/**
 * Splash gate. Decides whether to send the user to the role picker (no user)
 * or into the role-aware tab navigator (signed in).
 */
export default function IndexRoute(): JSX.Element {
  const { user, ready } = useAuth()
  const tagline = (Constants.expoConfig?.extra?.['splashTagline'] as string | undefined) ?? 'Borjie · Ofisi ya Mgodi'

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.tagline}>{tagline}</Text>
        <ActivityIndicator color={colors.gold} style={styles.spinner} />
      </View>
    )
  }
  if (!user) {
    return <Redirect href="/onboarding/role" />
  }
  return <Redirect href="/(tabs)/home" />
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.earth700,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tagline: {
    color: colors.goldLight,
    fontSize: fontSize.h2,
    fontWeight: '700'
  },
  spinner: {
    marginTop: spacing.xl
  }
})
