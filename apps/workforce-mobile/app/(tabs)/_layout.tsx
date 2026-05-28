/**
 * Workforce-mobile tab layout — Wave WORKFORCE-FIXED-TABS.
 *
 * Server-driven, FIXED tabs only. There is NO local spawn / close /
 * reorder UI. The visible tab strip is the intersection of:
 *   (a) the workforce_role_tab_configs row for this user's
 *       (role, site_scope), and
 *   (b) the file-system screens present in this folder.
 *
 * If the worker wants different tabs they use the
 * `RequestTabChangeSheet` (from the Profile tab or auto-popped by
 * HomeChat) which posts to /api/v1/workforce/tab-change-requests for
 * owner approval. The brain prompt blocks promises of tab changes.
 *
 * Every file-system screen exists; we hide unused ones via `href: null`.
 * The order shown to the user mirrors the order returned by the server.
 */
import { useMemo } from 'react'
import { Tabs } from 'expo-router'
import { useI18n } from '../../src/i18n/useI18n'
import { tokens } from '../../src/ui-litfin'
import { useWorkforceTabConfig } from '../../src/lib/hooks/useWorkforceTabConfig'

/**
 * Map catalog tab ids → file-system screen names. The workforce-mobile
 * app currently ships these expo-router files: home, dashboard, field,
 * decisions, cash, people, sites, docs, ask, documents. We alias the
 * richer catalog ids onto them so the tab strip can be driven entirely
 * by the catalog while screens remain unchanged. As new screens land
 * the unique aliases collapse — every catalog id should point to a
 * dedicated screen once the migration completes.
 */
const CATALOG_TO_SCREEN: Readonly<Record<string, string>> = {
  shift: 'dashboard',
  tasks: 'field',
  crew: 'people',
  dispatch: 'sites',
  incidents: 'decisions',
  'drill-log': 'sites',
  assay: 'docs',
  treasury: 'cash',
  compliance: 'docs',
  chat: 'home',
  reports: 'documents',
  profile: 'ask'
}

const ALL_SCREEN_NAMES = [
  'home',
  'dashboard',
  'field',
  'decisions',
  'cash',
  'people',
  'sites',
  'docs',
  'documents',
  'ask'
] as const

type ScreenName = (typeof ALL_SCREEN_NAMES)[number]

export default function TabsLayout(): JSX.Element {
  const { t } = useI18n()
  const { tabs } = useWorkforceTabConfig()

  // Resolve the server-returned catalog ids into screen-name + label
  // pairs. Deduplicate to keep expo-router happy when two catalog ids
  // alias the same screen (transitional state — see CATALOG_TO_SCREEN
  // comment). The dedupe keeps the FIRST occurrence so the server's
  // order is honoured.
  const enabled = useMemo(() => {
    const seen = new Set<string>()
    const result: Array<{ screen: ScreenName; label: string }> = []
    for (const tab of tabs) {
      const screen = CATALOG_TO_SCREEN[tab.id]
      if (!screen) continue
      if (seen.has(screen)) continue
      seen.add(screen)
      result.push({ screen: screen as ScreenName, label: tab.label })
    }
    return result
  }, [tabs])

  const enabledScreens = useMemo(
    () => new Set<string>(enabled.map((e) => e.screen)),
    [enabled]
  )

  const labelByScreen = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of enabled) map.set(e.screen, e.label)
    return map
  }, [enabled])

  const screenLabel = (screen: ScreenName): string => {
    const fromServer = labelByScreen.get(screen)
    if (fromServer) return fromServer
    // Fall back to the i18n bundle label if the server hasn't surfaced
    // one yet (e.g. during the cold-start hydrate).
    const fallback = (t.tabs as Record<string, string | undefined>)[screen]
    return fallback ?? screen
  }

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
      {ALL_SCREEN_NAMES.map((name) => {
        const visible = enabledScreens.has(name)
        const label = screenLabel(name)
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: label,
              headerTitle: label,
              href: visible ? `/(tabs)/${name}` : null
            }}
          />
        )
      })}
    </Tabs>
  )
}
