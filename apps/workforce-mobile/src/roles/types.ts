export type Role = 'owner' | 'manager' | 'employee'

export const ALL_ROLES: ReadonlyArray<Role> = ['owner', 'manager', 'employee']

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'manager' || value === 'employee'
}
