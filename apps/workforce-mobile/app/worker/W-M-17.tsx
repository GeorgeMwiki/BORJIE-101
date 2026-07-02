import { Redirect } from 'expo-router'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-17'

/**
 * W-M-17 has no real photo/marks data source yet, so a terminal
 * PhotoSlot/empty-PlaceholderList render here is a reachable-stub bug: the
 * screen is de-linked from the Field tab but the Stack route
 * (`/worker/W-M-17`) is still deep-linkable, and it previously hardcoded
 * Swahili-only strings (wrong language under EN). Rather than paint a dead,
 * language-mixed placeholder, redirect the route to the real Field surface
 * (its natural parent per app/(tabs)/field.tsx). A Redirect renders no
 * user-facing copy, so there is no locale to mix; the RoleGuard runs first
 * so an unauthorized role still gets the localized forbidden card. When a
 * real photo/marks query lands, this file backs it and re-enters the Field
 * list.
 */
export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <Redirect href="/(tabs)/field" />
    </RoleGuard>
  )
}
