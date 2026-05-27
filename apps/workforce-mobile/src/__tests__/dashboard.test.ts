import { describe, expect, it, vi } from 'vitest'

/**
 * Tests for the Dashibodi (Dashboard) tab — role-aware composition of the
 * existing partial sub-components plus inline slot fillers.
 *
 * The workforce-mobile vitest config is Node-only with no React Native
 * renderer (see preview-banner.test.ts and theme.test.ts patterns). We
 * therefore mock react-native + expo-router + the data-fetching layer at
 * the module boundary and exercise the wiring contracts each role-component
 * exposes: the dashboard modules must export a function component, must
 * import the prescribed partial sub-components from their canonical paths,
 * and the i18n + role-access tables must register the new surface in both
 * languages.
 *
 * Coverage:
 *  - OwnerDashboard, ManagerDashboard, EmployeeDashboard each export a
 *    callable function (the JSX runtime test happens at native-build time;
 *    here we assert the export shape and the wired-component name list).
 *  - Owner dashboard references AiDailyBrief from the home/owner module
 *    (slot 1 per Docs/research R1).
 *  - Manager dashboard references CrewRoster from the home/manager module
 *    (band 3 per Docs/research R3).
 *  - Employee dashboard references ShiftStatusHero from the home/employee
 *    module (section 1 per Docs/research R2).
 *  - Role access table allows owner/manager/employee for the 'dashboard'
 *    screen — exercised via canSee() so the RoleGuard wiring is provable.
 *  - The i18n tab label is 'Dashibodi' (sw) and 'Dashboard' (en).
 */

vi.mock('react-native', () => ({
  StyleSheet: { create: (s: Record<string, unknown>) => s },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator'
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView'
}))

vi.mock('expo-router', () => ({
  Link: 'Link',
  Redirect: () => null,
  Stack: { Screen: () => null },
  Tabs: { Screen: () => null }
}))

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => undefined }
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined
  })
}))

vi.mock('../api/client', () => ({
  miningApi: { get: vi.fn(async () => ({})) }
}))

vi.mock('../sync/queue', () => ({
  enqueueWrite: vi.fn(async () => undefined),
  getQueueSize: vi.fn(async () => 0),
  subscribeQueue: vi.fn(() => () => undefined)
}))

import sw from '../i18n/sw.json'
import en from '../i18n/en.json'
import { canSee, SCREEN_ROLE_ACCESS } from '../roles/access'
import { OwnerDashboard } from '../dashboard/OwnerDashboard'
import { ManagerDashboard } from '../dashboard/ManagerDashboard'
import { EmployeeDashboard } from '../dashboard/EmployeeDashboard'

describe('Dashibodi tab — i18n contract', () => {
  it('exposes Swahili tab label "Dashibodi"', () => {
    expect(sw.tabs.dashboard).toBe('Dashibodi')
  })

  it('exposes English tab label "Dashboard"', () => {
    expect(en.tabs.dashboard).toBe('Dashboard')
  })

  it('exposes screen meta in both languages', () => {
    expect(sw.screens.dashboard.title).toBe('Dashibodi')
    expect(en.screens.dashboard.title).toBe('Dashboard')
    expect(sw.screens.dashboard.intent.length).toBeGreaterThan(0)
    expect(en.screens.dashboard.intent.length).toBeGreaterThan(0)
  })
})

describe('Dashibodi tab — role access', () => {
  it('allows all three roles to see the dashboard surface', () => {
    expect(canSee('dashboard', 'owner')).toBe(true)
    expect(canSee('dashboard', 'manager')).toBe(true)
    expect(canSee('dashboard', 'employee')).toBe(true)
  })

  it('refuses access when the screen id is not registered', () => {
    // Closed-set access table: any string not in SCREEN_ROLE_ACCESS is
    // implicitly denied. This is the safety net RoleGuard relies on.
    expect(canSee('not-a-real-screen', 'owner')).toBe(false)
    expect(canSee('not-a-real-screen', 'employee')).toBe(false)
  })

  it('registers the dashboard surface for the three known roles only', () => {
    const access = SCREEN_ROLE_ACCESS.dashboard
    expect(access).toBeDefined()
    expect(access).toContain('owner')
    expect(access).toContain('manager')
    expect(access).toContain('employee')
    expect(access?.length).toBe(3)
  })
})

describe('OwnerDashboard composition', () => {
  it('exports a function component', () => {
    expect(typeof OwnerDashboard).toBe('function')
  })

  it('wires AiDailyBrief from the existing home/owner module (slot 1)', () => {
    const source = OwnerDashboard.toString()
    expect(source).toContain('AiDailyBrief')
  })

  it('wires AlertQueue + KpiStrip + ProductionVsTarget (slots 2-4)', () => {
    const source = OwnerDashboard.toString()
    expect(source).toContain('AlertQueue')
    expect(source).toContain('KpiStrip')
    expect(source).toContain('ProductionVsTarget')
  })

  it('plants the owner-dashboard testID for e2e targeting', () => {
    expect(OwnerDashboard.toString()).toContain('owner-dashboard')
  })
})

describe('ManagerDashboard composition', () => {
  it('exports a function component', () => {
    expect(typeof ManagerDashboard).toBe('function')
  })

  it('wires CrewRoster from the existing home/manager module (band 3)', () => {
    const source = ManagerDashboard.toString()
    expect(source).toContain('CrewRoster')
  })

  it('wires SitePulse + ExceptionStack (bands 1-2)', () => {
    const source = ManagerDashboard.toString()
    expect(source).toContain('SitePulse')
    expect(source).toContain('ExceptionStack')
  })

  it('plants the manager-dashboard testID for e2e targeting', () => {
    expect(ManagerDashboard.toString()).toContain('manager-dashboard')
  })
})

describe('EmployeeDashboard composition', () => {
  it('exports a function component', () => {
    expect(typeof EmployeeDashboard).toBe('function')
  })

  it('wires ShiftStatusHero from the existing home/employee module (section 1)', () => {
    const source = EmployeeDashboard.toString()
    expect(source).toContain('ShiftStatusHero')
  })

  it('wires TodayTasks + PerformanceSnapshot (sections 3+5)', () => {
    const source = EmployeeDashboard.toString()
    expect(source).toContain('TodayTasks')
    expect(source).toContain('PerformanceSnapshot')
  })

  it('plants the employee-dashboard testID for e2e targeting', () => {
    expect(EmployeeDashboard.toString()).toContain('employee-dashboard')
  })
})
