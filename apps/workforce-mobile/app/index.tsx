import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import Constants from 'expo-constants'
import { useAuth } from '../src/auth/useAuth'
import { tokens } from '../src/ui-litfin'

/**
 * Splash gate. Decides whether to send the user to the role picker (no user)
 * or into the role-aware tab navigator (signed in).
 *
 * LitFin-styled — navy-slate ground, gold wordmark, gold spinner. Matches
 * the marketing site hero rhythm so the first paint feels continuous with
 * the web brand.
 */
export default function IndexRoute(): JSX.Element {
  const { user, ready } = useAuth()
  const tagline = (Constants.expoConfig?.extra?.['splashTagline'] as string | undefined) ?? 'Borjie · Ofisi ya Mgodi'

  if (!ready) {
    return (
      <View style={styles.splash}>
        <Text style={styles.wordmark}>BORJIE</Text>
        <Text style={styles.tagline}>{tagline}</Text>
        <ActivityIndicator color={tokens.color.gold} style={styles.spinner} />
      </View>
    )
  }
  if (!user) {
    return <Redirect href="/onboarding/welcome" />
  }
  return <Redirect href="/(tabs)/home" />
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: tokens.color.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.space.xl
  },
  wordmark: {
    color: tokens.color.gold,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 6
  },
  tagline: {
    ...tokens.type.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.space.md,
    textAlign: 'center'
  },
  spinner: {
    marginTop: tokens.space.xl
  }
})
