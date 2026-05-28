import { Redirect } from 'expo-router'
import Constants from 'expo-constants'
import { useAuth } from '../src/auth/useAuth'
import { LitFinSplash } from '../src/ui-litfin'

/**
 * Splash gate. Decides whether to send the user to the role picker
 * (no user) or into the role-aware tab navigator (signed in).
 *
 * LitFin-styled — navy slate ground, gold wordmark reveal, gold
 * spinner. Matches the marketing-site hero rhythm so the first paint
 * feels continuous with the web brand.
 */
export default function IndexRoute(): JSX.Element {
  const { user, ready } = useAuth()
  const tagline =
    (Constants.expoConfig?.extra?.['splashTagline'] as string | undefined) ??
    'Ofisi ya Mgodi. Estate intelligence.'
  if (!ready) {
    return <LitFinSplash wordmark="BORJIE" tagline={tagline} showSpinner />
  }
  if (!user) {
    return <Redirect href="/onboarding/welcome" />
  }
  return <Redirect href="/(tabs)/home" />
}
