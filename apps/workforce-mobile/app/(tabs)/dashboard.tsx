import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { RoleGuard } from '../../src/components/RoleGuard'
import { ScreenShell } from '../../src/components/ScreenShell'
import { useAuth } from '../../src/auth/useAuth'
import { useI18n } from '../../src/i18n/useI18n'
import { EmployeeDashboard } from '../../src/dashboard/EmployeeDashboard'
import { ManagerDashboard } from '../../src/dashboard/ManagerDashboard'
import { OwnerDashboard } from '../../src/dashboard/OwnerDashboard'
import {
  LitFinPageHero,
  LitFinButton,
  greet,
  tokens
} from '../../src/ui-litfin'

const SCREEN_ID = 'dashboard'

/**
 * Dashboard tab — Dashibodi (Swahili) / Dashboard (English).
 *
 * LitFin-styled — opens with the borrower-dashboard hero rhythm
 * (eyebrow + display title + warm bilingual greeting + CTAs), then
 * routes into the role-aware composed status surface. The Home tab
 * remains chat-first.
 */
export default function DashboardTab(): JSX.Element {
  const router = useRouter()
  const { user } = useAuth()
  const { lang, t } = useI18n()
  const role = user?.role ?? 'employee'
  const firstName = (user?.fullName ?? '').split(' ')[0] ?? null
  const hero = t.dashboardHero
  const eyebrow = hero.eyebrow
  const subtitle =
    role === 'owner'
      ? hero.subtitleOwner
      : role === 'manager'
        ? hero.subtitleManager
        : hero.subtitleEmployee
  const primaryCtaLabel = hero.askCta
  const secondaryCtaLabel = hero.scheduleCta

  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <LitFinPageHero
          eyebrow={eyebrow}
          title={greet(lang, firstName)}
          subtitle={subtitle}
          actions={
            <>
              <LitFinButton
                label={primaryCtaLabel}
                onPress={() => router.push('/(tabs)/ask')}
                variant="primary"
                size="md"
                leadingIcon="*"
              />
              <LitFinButton
                label={secondaryCtaLabel}
                onPress={() => router.push('/(tabs)/field')}
                variant="secondary"
                size="md"
              />
            </>
          }
        />
        <View style={{ paddingTop: tokens.space.md }}>
          {role === 'owner' ? <OwnerDashboard /> : null}
          {role === 'manager' ? <ManagerDashboard /> : null}
          {role === 'employee' ? <EmployeeDashboard /> : null}
        </View>
      </ScreenShell>
    </RoleGuard>
  )
}
