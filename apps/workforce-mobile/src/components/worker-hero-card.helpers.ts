/**
 * Pure helpers for WorkerHeroCard / WorkerHomeHero.
 *
 * Lives in a `.ts` (no JSX) so the workforce-mobile vitest config (node
 * runtime, no JSX runtime) can import and exercise the logic without
 * pulling in React Native. The presentational `WorkerHeroCard` component
 * re-exports these helpers so consumers have one canonical entry point.
 */

import type { Lang } from '../auth/types'
import { pickByLocale } from '../i18n/pickByLocale'

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

/**
 * Generic role noun per locale, used ONLY when neither role field is present.
 * Each entry is a single-language string; the active locale selects one — there
 * is no cross-language fallback.
 */
const DEFAULT_ROLE_LABEL: Readonly<Record<Lang, string>> = {
  en: 'Worker',
  sw: 'Mfanyakazi',
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
  // Active-locale-or-localized-default — NEVER the other tongue. `me.roleLabel`
  // is the EN field, `me.roleLabelSw` the SW field; pickByLocale yields the
  // active-locale value (or the visible `—` placeholder when that single field
  // is missing), so a missing SW value never silently renders the EN string.
  // A wholly-absent pair falls to the active-locale generic role noun.
  const rolePair = {
    en: typeof me?.roleLabel === 'string' ? me.roleLabel : '',
    sw: typeof me?.roleLabelSw === 'string' ? me.roleLabelSw : '',
  }
  const roleLabel =
    rolePair.en === '' && rolePair.sw === ''
      ? DEFAULT_ROLE_LABEL[locale]
      : pickByLocale(rolePair, locale)
  const shiftStatus: ShiftStatus = isShiftStatus(me?.shiftStatus)
    ? me!.shiftStatus
    : 'no_shift'
  // Same active-locale-only discipline for the shift detail line: no
  // cross-language fallback. An absent active-locale value yields undefined
  // (the row is then simply not rendered) rather than the other locale's text.
  const shiftDetailRaw = locale === 'sw' ? me?.shiftDetailSw : me?.shiftDetail
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
