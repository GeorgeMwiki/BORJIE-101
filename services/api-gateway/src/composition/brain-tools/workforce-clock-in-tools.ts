/**
 * Workforce clock-in brain tools — chat-as-OS parity for migration 0103.
 *
 * Three tools backing the `/api/v1/workforce/clock-in` family:
 *
 *   - `workforce.clock_in_query`    list today's clock-in events at a site
 *   - `workforce.attendance_status` aggregate today's attendance for a site
 *
 * Both surfaces (chat + the explicit Workforce tab) hit the identical
 * backend so the brain reads the same rows the UI reads. Tools are
 * read-only so they remain LOW stakes and skip the audit-write path.
 *
 * The clock-in WRITE path stays in the explicit `/clock-in` endpoint
 * because biometric attestation is a device-side concern (the brain
 * cannot synthesise a biometric pass).
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const WORKFORCE_PERSONAS: ReadonlyArray<
  'T1_owner_strategist' | 'T3_module_manager' | 'T4_field_employee'
> = ['T1_owner_strategist', 'T3_module_manager', 'T4_field_employee'];

// ---------------------------------------------------------------------------
// 1. workforce.clock_in_query
// ---------------------------------------------------------------------------

const ClockInQueryInput = z.object({
  siteId: z.string().uuid().optional(),
});
const ClockInQueryOutput = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      employeeId: z.string(),
      siteId: z.string(),
      clockedInAt: z.string(),
      clockedOutAt: z.string().nullable(),
      biometricProvider: z.string(),
      biometricPassed: z.boolean(),
    }),
  ),
});
export const workforceClockInQueryTool: PersonaToolDescriptor<
  typeof ClockInQueryInput,
  typeof ClockInQueryOutput
> = {
  id: 'workforce.clock_in_query',
  name: 'Workforce — today\'s clock-in events',
  description:
    'List today\'s biometric clock-in / clock-out events for the current ' +
    'tenant. Optional siteId filter. Read-only — defers to ' +
    '/workforce/clock-in/today.',
  personaSlugs: WORKFORCE_PERSONAS,
  inputSchema: ClockInQueryInput,
  outputSchema: ClockInQueryOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { events: [] };
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/workforce/clock-in/today', {
      query: { tenantId: ctx.tenantId, siteId: input.siteId },
    });
    const rows = response.data ?? [];
    return {
      events: rows.map((r) => ({
        id: String(r.id),
        employeeId: String(r.employee_id),
        siteId: String(r.site_id),
        clockedInAt: String(r.clocked_in_at),
        clockedOutAt: r.clocked_out_at ? String(r.clocked_out_at) : null,
        biometricProvider: String(r.biometric_provider),
        biometricPassed: Boolean(r.biometric_passed),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// 2. workforce.attendance_status
// ---------------------------------------------------------------------------

const AttendanceStatusInput = z.object({
  siteId: z.string().uuid().optional(),
});
const AttendanceStatusOutput = z.object({
  forDate: z.string(),
  totalEvents: z.number().int(),
  openShifts: z.number().int(),
  closedShifts: z.number().int(),
  biometricFailures: z.number().int(),
});
export const workforceAttendanceStatusTool: PersonaToolDescriptor<
  typeof AttendanceStatusInput,
  typeof AttendanceStatusOutput
> = {
  id: 'workforce.attendance_status',
  name: 'Workforce — attendance status',
  description:
    'Aggregate today\'s clock-in events into open / closed / biometric-fail ' +
    'counts. Read-only — defers to /workforce/clock-in/today and aggregates.',
  personaSlugs: WORKFORCE_PERSONAS,
  inputSchema: AttendanceStatusInput,
  outputSchema: AttendanceStatusOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    const today = new Date().toISOString().slice(0, 10);
    if (!client) {
      return {
        forDate: today,
        totalEvents: 0,
        openShifts: 0,
        closedShifts: 0,
        biometricFailures: 0,
      };
    }
    const response = await client.get<{
      success: boolean;
      data?: ReadonlyArray<Record<string, unknown>>;
    }>('/workforce/clock-in/today', {
      query: { tenantId: ctx.tenantId, siteId: input.siteId },
    });
    const rows = response.data ?? [];
    const closed = rows.filter((r) => Boolean(r.clocked_out_at)).length;
    const fails = rows.filter((r) => !r.biometric_passed).length;
    return {
      forDate: today,
      totalEvents: rows.length,
      openShifts: rows.length - closed,
      closedShifts: closed,
      biometricFailures: fails,
    };
  },
};

// ---------------------------------------------------------------------------
// Export catalogue.
// ---------------------------------------------------------------------------

export const WORKFORCE_CLOCK_IN_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  workforceClockInQueryTool,
  workforceAttendanceStatusTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
