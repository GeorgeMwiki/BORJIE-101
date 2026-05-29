/**
 * Pure helpers for WorkerHeroCard / WorkerHomeHero.
 *
 * Lives in a `.ts` (no JSX) so the workforce-mobile vitest config (node
 * runtime, no JSX runtime) can import and exercise the logic without
 * pulling in React Native. The presentational `WorkerHeroCard` component
 * re-exports these helpers so consumers have one canonical entry point.
 */

export type ShiftStatus = 'active' | 'on_break' | 'off_shift' | 'no_shift'

export interface WorkerHeroTask {
  readonly id: string
  readonly titleEn: string
  readonly titleSw: string
  readonly location?: string
  readonly startedAt?: string
  readonly dueAt?: string
}

export interface WorkerHeroCardData {
  readonly workerName: string
  readonly roleLabel: string
  readonly shiftStatus: ShiftStatus
  readonly shiftDetail?: string
  readonly nextTask: WorkerHeroTask | null
}

export interface ShiftStatusVisual {
  readonly labelEn: string
  readonly labelSw: string
  readonly tone: 'success' | 'warn' | 'muted'
}

export const SHIFT_STATUS_VISUALS: Readonly<
  Record<ShiftStatus, ShiftStatusVisual>
> = {
  active: { labelEn: 'On shift', labelSw: 'Kazini', tone: 'success' },
  on_break: { labelEn: 'On break', labelSw: 'Mapumziko', tone: 'warn' },
  off_shift: {
    labelEn: 'Off shift',
    labelSw: 'Nje ya zamu',
    tone: 'muted',
  },
  no_shift: {
    labelEn: 'No shift scheduled',
    labelSw: 'Hakuna zamu',
    tone: 'muted',
  },
}

export function formatTimerHms(elapsedMs: number): string {
  const safe = Math.max(0, Math.floor(elapsedMs / 1000))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export function selectShiftVisual(status: ShiftStatus): ShiftStatusVisual {
  return SHIFT_STATUS_VISUALS[status]
}

// ─── buildHeroData ──────────────────────────────────────────────────

export interface MeResponseShape {
  readonly workerName?: string
  readonly roleLabel?: string
  readonly roleLabelSw?: string
  readonly shiftStatus?: ShiftStatus
  readonly shiftDetail?: string
  readonly shiftDetailSw?: string
}

export interface NextTaskResponseShape {
  readonly id?: string
  readonly titleEn?: string
  readonly titleSw?: string
  readonly location?: string
  readonly startedAt?: string
  readonly dueAt?: string
}

const SHIFT_STATUSES: ReadonlyArray<ShiftStatus> = [
  'active',
  'on_break',
  'off_shift',
  'no_shift',
]

function isShiftStatus(value: unknown): value is ShiftStatus {
  return (
    typeof value === 'string' &&
    SHIFT_STATUSES.includes(value as ShiftStatus)
  )
}

export function buildHeroData(
  me: MeResponseShape | null,
  task: NextTaskResponseShape | null,
  fallbackName: string,
  locale: 'sw' | 'en',
): WorkerHeroCardData {
  const workerName =
    typeof me?.workerName === 'string' && me.workerName.length > 0
      ? me.workerName
      : fallbackName
  const roleLabel =
    locale === 'sw'
      ? (me?.roleLabelSw ?? me?.roleLabel ?? 'Mfanyakazi')
      : (me?.roleLabel ?? me?.roleLabelSw ?? 'Worker')
  const shiftStatus: ShiftStatus = isShiftStatus(me?.shiftStatus)
    ? me!.shiftStatus
    : 'no_shift'
  const shiftDetailRaw =
    locale === 'sw'
      ? (me?.shiftDetailSw ?? me?.shiftDetail)
      : (me?.shiftDetail ?? me?.shiftDetailSw)
  const shiftDetail =
    typeof shiftDetailRaw === 'string' && shiftDetailRaw.length > 0
      ? shiftDetailRaw
      : undefined

  let nextTask: WorkerHeroTask | null = null
  if (
    task &&
    typeof task.id === 'string' &&
    task.id.length > 0 &&
    typeof task.titleEn === 'string' &&
    typeof task.titleSw === 'string'
  ) {
    const built: WorkerHeroTask = {
      id: task.id,
      titleEn: task.titleEn,
      titleSw: task.titleSw,
      ...(typeof task.location === 'string' ? { location: task.location } : {}),
      ...(typeof task.startedAt === 'string'
        ? { startedAt: task.startedAt }
        : {}),
      ...(typeof task.dueAt === 'string' ? { dueAt: task.dueAt } : {}),
    }
    nextTask = built
  }

  return {
    workerName,
    roleLabel,
    shiftStatus,
    ...(shiftDetail !== undefined ? { shiftDetail } : {}),
    nextTask,
  }
}
