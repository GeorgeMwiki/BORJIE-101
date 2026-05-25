import type { Role } from './types'

/**
 * Maps screen IDs from the UI_SCREEN_CATALOGUE (sections A and C) to the roles
 * permitted to view them. The same Expo app ships every screen, but the tab
 * navigator and route guards consult this table to hide what should not be
 * shown to the current user.
 *
 * Convention:
 *  - O-M-XX = Owner mobile screens (default: owner only).
 *    - Some are visible to managers (e.g. People, Tasks, Site detail).
 *  - W-M-XX = Worker mobile screens (default: employee + manager).
 */
export const SCREEN_ROLE_ACCESS: Readonly<Record<string, ReadonlyArray<Role>>> = {
  // Owner mobile (A.1 - A.25)
  'O-M-01': ['owner'],
  'O-M-02': ['owner', 'manager'],
  'O-M-03': ['owner'],
  'O-M-04': ['owner', 'manager'],
  'O-M-05': ['owner', 'manager'],
  'O-M-06': ['owner', 'manager'],
  'O-M-07': ['owner'],
  'O-M-08': ['owner', 'manager'],
  'O-M-09': ['owner', 'manager'],
  'O-M-10': ['owner'],
  'O-M-11': ['owner', 'manager'],
  'O-M-12': ['owner', 'manager'],
  'O-M-13': ['owner', 'manager'],
  'O-M-14': ['owner', 'manager'],
  'O-M-15': ['owner', 'manager'],
  'O-M-16': ['owner', 'manager'],
  'O-M-17': ['owner'],
  'O-M-18': ['owner'],
  'O-M-19': ['owner', 'manager'],
  'O-M-20': ['owner', 'manager'],
  'O-M-21': ['owner', 'manager', 'employee'],
  'O-M-22': ['owner'],
  'O-M-23': ['owner'],
  'O-M-24': ['owner', 'manager', 'employee'],
  'O-M-25': ['owner'],

  // Worker mobile (C.1 - C.22)
  'W-M-01': ['owner', 'manager', 'employee'],
  'W-M-02': ['employee', 'manager'],
  'W-M-03': ['employee', 'manager'],
  'W-M-04': ['employee', 'manager'],
  'W-M-05': ['employee', 'manager'],
  'W-M-06': ['employee', 'manager'],
  'W-M-07': ['employee', 'manager'],
  'W-M-08': ['employee', 'manager'],
  'W-M-09': ['employee', 'manager'],
  'W-M-10': ['employee', 'manager'],
  'W-M-11': ['employee', 'manager'],
  'W-M-12': ['employee', 'manager'],
  'W-M-13': ['employee', 'manager'],
  'W-M-14': ['employee', 'manager'],
  'W-M-15': ['employee', 'manager'],
  'W-M-16': ['employee', 'manager', 'owner'],
  'W-M-17': ['employee', 'manager'],
  'W-M-18': ['employee', 'manager', 'owner'],
  'W-M-19': ['employee', 'manager'],
  'W-M-20': ['employee', 'manager'],
  'W-M-21': ['employee', 'manager', 'owner'],
  'W-M-22': ['employee', 'manager', 'owner']
} as const

export function canSee(screenId: string, role: Role): boolean {
  const roles = SCREEN_ROLE_ACCESS[screenId]
  if (!roles) {
    return false
  }
  return roles.includes(role)
}

export function isOwnerArea(role: Role): boolean {
  return role === 'owner'
}

export function isWorkerArea(role: Role): boolean {
  return role === 'employee'
}
