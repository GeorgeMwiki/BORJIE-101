import { RoleGuard } from '../../src/components/RoleGuard'
import { ScreenShell } from '../../src/components/ScreenShell'
import { useAuth } from '../../src/auth/useAuth'
import { EmployeeDashboard } from '../../src/dashboard/EmployeeDashboard'
import { ManagerDashboard } from '../../src/dashboard/ManagerDashboard'
import { OwnerDashboard } from '../../src/dashboard/OwnerDashboard'

const SCREEN_ID = 'dashboard'

/**
 * Dashboard tab — Dashibodi (Swahili) / Dashboard (English).
 *
 * Secondary view alongside the chat-first Home tab. Surfaces the role-aware
 * structured status cards (Owner cockpit, Manager cockpit, Worker shift
 * sections). The Home tab remains chat-first and is owned by the CH-Workforce
 * agent — this surface composes the existing partial sub-components built by
 * the F-Owner / F-Manager / F-Worker agents into one scrollable view.
 */
export default function DashboardTab(): JSX.Element {
  const { user } = useAuth()
  const role = user?.role ?? 'employee'
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        {role === 'owner' ? <OwnerDashboard /> : null}
        {role === 'manager' ? <ManagerDashboard /> : null}
        {role === 'employee' ? <EmployeeDashboard /> : null}
      </ScreenShell>
    </RoleGuard>
  )
}
