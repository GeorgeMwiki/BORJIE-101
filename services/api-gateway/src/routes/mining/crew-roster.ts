/**
 * Crew Roster assembly for the manager HOME band (workforce-mobile W-M-02M).
 *
 * `GET /api/v1/mining/attendance/crew-roster` returns the site's crew. The
 * previous mobile call read GET /attendance (the caller's OWN attendance
 * history, `{ success, data: rows }`) and cast it to a `{ items: CrewMember[] }`
 * with fabricated `workloadPct`/`equipmentPaired` fields — always empty /
 * wrong-shape. This assembler builds each row from REAL sources only:
 *
 *   id           — employees.id
 *   fullName     — employees.full_name
 *   role         — employees.role
 *   status       — derived from today's attendance row:
 *                    present → on_site, late → late, absent → absent,
 *                    (no row) → off. NEVER a fabricated on-shift claim.
 *   workloadPct  — null. No per-worker workload/utilization source.
 *   equipmentPaired — null. No worker↔equipment pairing table.
 *
 * Pure so it is unit-testable cold. The Hono handler does the DB read (LEFT
 * JOIN employees → today's attendance) and maps each row through here.
 */

export type CrewStatus = 'on_site' | 'late' | 'break' | 'absent' | 'off';

/** One crew row on the wire. Null fields = honest "not tracked". */
export interface CrewMemberWire {
  readonly id: string;
  readonly fullName: string;
  readonly role: string;
  readonly status: CrewStatus;
  readonly workloadPct: number | null;
  readonly equipmentPaired: string | null;
}

/** Raw joined row: an employee plus today's attendance status (null = no row). */
export interface CrewRosterRow {
  readonly id: string | null;
  readonly fullName: string | null;
  readonly role: string | null;
  readonly attendanceStatus: string | null;
}

/**
 * Map a raw attendance.status onto the crew-home vocabulary. The attendance
 * enum is present|absent|sick|leave|terminated_today; a null (no row today)
 * means the worker is off shift. Anything unrecognized falls to 'off' rather
 * than fabricating an on-site claim.
 */
export function crewStatusFor(attendanceStatus: string | null): CrewStatus {
  switch (attendanceStatus) {
    case 'present':
      return 'on_site';
    case 'late':
      return 'late';
    case 'absent':
    case 'sick':
    case 'leave':
    case 'terminated_today':
      return 'absent';
    default:
      return 'off';
  }
}

export function adaptCrewMember(row: CrewRosterRow): CrewMemberWire {
  return {
    id: String(row.id ?? ''),
    fullName: row.fullName ?? '',
    role: row.role ?? '',
    status: crewStatusFor(row.attendanceStatus),
    // Honest nulls — no workload or equipment-pairing source is wired.
    workloadPct: null,
    equipmentPaired: null,
  };
}

export function adaptCrewRoster(
  rows: ReadonlyArray<CrewRosterRow>,
): ReadonlyArray<CrewMemberWire> {
  return rows.map((row) => adaptCrewMember(row));
}
