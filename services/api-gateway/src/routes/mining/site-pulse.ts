/**
 * Site Pulse assembly for the manager HOME band (workforce-mobile W-M-02M).
 *
 * `GET /api/v1/mining/cockpit` returns this shape. Every field is wired to a
 * REAL source or emitted as an honest `null` — NEVER a fabricated 0/1/sentinel
 * that a KPI tile would render as a fact (the exact anti-fabrication defect
 * this fix closes). The mobile SitePulse tile renders "—"/not-tracked for any
 * null field so the band stays honest and non-broken.
 *
 * Field provenance:
 *   siteName               — sites.name (resolved by siteId, else null)
 *   shiftLabel             — 'day'|'night' key derived from local clock (the
 *                            mobile layer localizes the key; no English prose)
 *   planAttainmentPct      — null. No per-site production TARGET feed exists
 *                            (cockpit daily-brief emits grammesTargetToday:null
 *                            for the same reason). Attainment % is undefinable
 *                            without a target, so we omit rather than fabricate.
 *   crewOnShift            — COUNT(DISTINCT present employees) from attendance
 *   crewExpected           — null. No rostered-expected headcount source.
 *   equipmentAvailabilityPct — null. No equipment/asset availability table.
 *   alertsCount            — COUNT of open critical|high incidents (real)
 *   safetyStatus           — derived from open incident severity (real)
 *
 * The pure assembler below takes already-fetched primitives so it is unit-
 * testable cold (same pattern as brief.hono.ts slot computers). The Hono
 * handler in cockpit.hono.ts does the DB reads and calls this.
 */

export type SafetyStatus = 'green' | 'amber' | 'red';
export type ShiftKey = 'day' | 'night';

/** Wire shape returned by GET /cockpit. Nullable fields = honest "not tracked". */
export interface SitePulseWire {
  readonly siteName: string | null;
  readonly shiftKey: ShiftKey;
  readonly planAttainmentPct: number | null;
  readonly crewOnShift: number | null;
  readonly crewExpected: number | null;
  readonly equipmentAvailabilityPct: number | null;
  readonly alertsCount: number;
  readonly safetyStatus: SafetyStatus;
}

/** Real inputs the assembler needs, each already read from its own source. */
export interface SitePulseInputs {
  readonly siteName: string | null;
  readonly crewOnShift: number | null;
  readonly openCriticalCount: number;
  readonly openHighCount: number;
  /** Local hour (0-23) used only to label the current shift, not a metric. */
  readonly localHour: number;
}

/**
 * Day shift is 06:00–17:59 local, night otherwise. This is a LABEL derived
 * from the clock, not a fabricated data point — it never claims a value that
 * has no source.
 */
export function shiftKeyForHour(localHour: number): ShiftKey {
  return localHour >= 6 && localHour < 18 ? 'day' : 'night';
}

/**
 * Safety status from OPEN incident severity — the true signal:
 *   any open critical → red, else any open high → amber, else green.
 * `alertsCount` is critical+high combined (matches the mobile Alerts tile).
 */
export function assembleSitePulse(inputs: SitePulseInputs): SitePulseWire {
  const alertsCount = inputs.openCriticalCount + inputs.openHighCount;
  const safetyStatus: SafetyStatus =
    inputs.openCriticalCount > 0 ? 'red' : inputs.openHighCount > 0 ? 'amber' : 'green';
  return {
    siteName: inputs.siteName,
    shiftKey: shiftKeyForHour(inputs.localHour),
    // Honest nulls — no target / roster-expected / equipment source is wired.
    planAttainmentPct: null,
    crewOnShift: inputs.crewOnShift,
    crewExpected: null,
    equipmentAvailabilityPct: null,
    alertsCount,
    safetyStatus,
  };
}
