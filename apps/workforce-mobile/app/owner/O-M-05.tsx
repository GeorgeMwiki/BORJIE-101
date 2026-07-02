import { Redirect } from 'expo-router'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-05'

/**
 * O-M-05 has no real owner recent-shift / photos data source yet, so a
 * terminal PlaceholderList/PhotoSlot render here is a reachable-stub bug:
 * the screen is de-linked from the tabs but the Stack route
 * (`/owner/O-M-05`) is still deep-linkable. Rather than paint a dead
 * placeholder, redirect the route to the real Sites surface (its natural
 * parent per app/(tabs)/sites.tsx). The RoleGuard runs first so an
 * unauthorized role still gets the localized forbidden card — the redirect
 * never leaks a screen the role cannot see. When a real recent-shifts query
 * lands, this file backs it and re-enters the Sites "related" list.
 */
export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <Redirect href="/(tabs)/sites" />
    </RoleGuard>
  )
}
