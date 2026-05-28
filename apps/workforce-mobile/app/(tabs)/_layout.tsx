import { Tabs } from 'expo-router'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { tokens } from '../../src/ui-litfin'
import type { Role } from '../../src/roles/types'

/**
 * Role-aware tab navigator. Every tab exists in the file system, but `href:
 * null` hides it from the navigator when the current role shouldn't see it.
 * This is the primary gating mechanism for top-level surfaces; per-screen
 * routes also use <RoleGuard /> for direct-link safety.
 */
export default function TabsLayout(): JSX.Element {
  const { user } = useAuth()
  const { t } = useI18n()
  const role: Role = user?.role ?? 'employee'

  const isOwner = role === 'owner'
  const isManager = role === 'manager'
  const isEmployee = role === 'employee'

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: tokens.color.bgSurface },
        headerTitleStyle: { color: tokens.color.textPrimary, fontWeight: '700' },
        headerTintColor: tokens.color.gold,
        tabBarStyle: {
          backgroundColor: tokens.color.bgRaised,
          borderTopColor: tokens.color.border,
          borderTopWidth: 1
        },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11, letterSpacing: 0.3 },
        tabBarActiveTintColor: tokens.color.gold,
        tabBarInactiveTintColor: tokens.color.textMuted
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: t.tabs.home, headerTitle: t.tabs.home }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ title: t.tabs.dashboard, headerTitle: t.tabs.dashboard }}
      />
      <Tabs.Screen
        name="field"
        options={{
          title: t.tabs.field,
          headerTitle: t.tabs.field,
          href: isEmployee || isManager ? '/(tabs)/field' : null
        }}
      />
      <Tabs.Screen
        name="decisions"
        options={{
          title: t.tabs.decisions,
          headerTitle: t.tabs.decisions,
          href: isOwner ? '/(tabs)/decisions' : null
        }}
      />
      <Tabs.Screen
        name="cash"
        options={{
          title: t.tabs.cash,
          headerTitle: t.tabs.cash,
          href: isOwner ? '/(tabs)/cash' : null
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: t.tabs.people,
          headerTitle: t.tabs.people,
          href: isOwner || isManager ? '/(tabs)/people' : null
        }}
      />
      <Tabs.Screen
        name="sites"
        options={{ title: t.tabs.sites, headerTitle: t.tabs.sites }}
      />
      <Tabs.Screen
        name="docs"
        options={{
          title: t.tabs.docs,
          headerTitle: t.tabs.docs,
          href: isOwner || isManager ? '/(tabs)/docs' : null
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: 'Hati hai',
          headerTitle: 'Hati hai',
          href: '/(tabs)/documents'
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{ title: t.tabs.ask, headerTitle: t.tabs.ask }}
      />
    </Tabs>
  )
}
