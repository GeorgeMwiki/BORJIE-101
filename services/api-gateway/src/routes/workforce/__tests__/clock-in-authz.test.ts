/**
 * authorizeClockIn — BOLA + BFLA guard for the workforce clock-in route.
 *
 * Regression oracle for B5: the POST /clock-in handler took a client-supplied
 * `employeeId` and a self-asserted biometric with NO ownership/role guard, so
 * any authenticated tenant user could record attendance (→ payroll) for any
 * other employee and bypass biometric via `manual_supervisor`. These tests pin
 * the guard: self-only for field workers, on-behalf + manual override for
 * supervisors.
 */
import { describe, it, expect } from 'vitest';
import { authorizeClockIn } from '../clock-in.hono.js';
import { UserRole } from '../../../types/user-role.js';

const SELF = 'user-self';
const OTHER = 'user-other';

describe('authorizeClockIn (BOLA + BFLA guard)', () => {
  it('allows a field worker to clock in THEMSELVES', () => {
    const r = authorizeClockIn({
      employeeId: SELF,
      callerUserId: SELF,
      callerRole: UserRole.MAINTENANCE_STAFF,
      biometricProvider: 'expo_local_auth',
    });
    expect(r.allowed).toBe(true);
  });

  it('DENIES a field worker clocking in ANOTHER employee (BOLA)', () => {
    const r = authorizeClockIn({
      employeeId: OTHER,
      callerUserId: SELF,
      callerRole: UserRole.MAINTENANCE_STAFF,
      biometricProvider: 'expo_local_auth',
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/supervisor/i);
  });

  it('DENIES a field worker using the manual_supervisor bypass on themselves (BFLA)', () => {
    const r = authorizeClockIn({
      employeeId: SELF,
      callerUserId: SELF,
      callerRole: UserRole.MAINTENANCE_STAFF,
      biometricProvider: 'manual_supervisor',
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/manual_supervisor/i);
  });

  it('allows a site manager (kiosk) to clock in another employee', () => {
    const r = authorizeClockIn({
      employeeId: OTHER,
      callerUserId: SELF,
      callerRole: UserRole.PROPERTY_MANAGER,
      biometricProvider: 'manual_supervisor',
    });
    expect(r.allowed).toBe(true);
  });

  it('allows an owner to clock in another employee', () => {
    const r = authorizeClockIn({
      employeeId: OTHER,
      callerUserId: SELF,
      callerRole: UserRole.OWNER,
      biometricProvider: 'webauthn_platform',
    });
    expect(r.allowed).toBe(true);
  });
});
