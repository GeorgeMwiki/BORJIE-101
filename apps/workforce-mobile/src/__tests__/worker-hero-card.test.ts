import { describe, expect, it } from 'vitest'

/**
 * WorkerHeroCard helper tests — Roadmap R5.
 *
 * The workforce-mobile vitest config runs in node with no JSX runtime.
 * The pure helpers live in `worker-hero-card.helpers.ts` (no JSX) so
 * they can be imported and exercised cold. The `.tsx` renderer is
 * covered by the Playwright E2E pack that runs against the Expo dev
 * server.
 */

import {
  buildHeroData,
  formatTimerHms,
  selectShiftVisual,
  SHIFT_STATUS_VISUALS,
  type ShiftStatus,
  type WorkerHeroCardData,
} from '../components/worker-hero-card.helpers'

describe('formatTimerHms', () => {
  it('returns mm:ss when under one hour', () => {
    expect(formatTimerHms(0)).toBe('00:00')
    expect(formatTimerHms(9_000)).toBe('00:09')
    expect(formatTimerHms(65_000)).toBe('01:05')
  })

  it('returns h:mm:ss past one hour', () => {
    expect(formatTimerHms(3_600_000)).toBe('1:00:00')
    expect(formatTimerHms(3_725_000)).toBe('1:02:05')
  })

  it('clamps negative input to zero', () => {
    expect(formatTimerHms(-10_000)).toBe('00:00')
  })
})

describe('selectShiftVisual', () => {
  const status: ReadonlyArray<ShiftStatus> = [
    'active',
    'on_break',
    'off_shift',
    'no_shift',
  ]

  it('returns a bilingual label and a tone for every shift status', () => {
    for (const s of status) {
      const visual = selectShiftVisual(s)
      expect(visual.labelEn.length).toBeGreaterThan(0)
      expect(visual.labelSw.length).toBeGreaterThan(0)
      expect(['success', 'warn', 'muted']).toContain(visual.tone)
    }
  })

  it('marks active as success and on_break as warn', () => {
    expect(selectShiftVisual('active').tone).toBe('success')
    expect(selectShiftVisual('on_break').tone).toBe('warn')
  })

  it('marks off_shift and no_shift as muted', () => {
    expect(selectShiftVisual('off_shift').tone).toBe('muted')
    expect(selectShiftVisual('no_shift').tone).toBe('muted')
  })

  it('exposes the SHIFT_STATUS_VISUALS map with all four statuses', () => {
    expect(Object.keys(SHIFT_STATUS_VISUALS).sort()).toEqual([
      'active',
      'no_shift',
      'off_shift',
      'on_break',
    ])
  })
})

describe('WorkerHeroCardData shape (compile-time contract)', () => {
  it('accepts a fully populated worker payload', () => {
    const data: WorkerHeroCardData = {
      workerName: 'Asha M.',
      roleLabel: 'Pit operator',
      shiftStatus: 'active',
      shiftDetail: 'Morning 06:00–14:00',
      nextTask: {
        id: 'task-1',
        titleEn: 'Inspect blast safety zone',
        titleSw: 'Kagua eneo la usalama wa kulipua',
        location: 'Pit 3 · 200 m',
        startedAt: '2026-05-29T07:15:00+03:00',
      },
    }
    expect(data.nextTask?.titleSw).toContain('Kagua')
  })

  it('accepts a null nextTask (between-tasks state)', () => {
    const data: WorkerHeroCardData = {
      workerName: 'Asha M.',
      roleLabel: 'Pit operator',
      shiftStatus: 'on_break',
      nextTask: null,
    }
    expect(data.nextTask).toBeNull()
  })
})

describe('buildHeroData', () => {
  it('falls back to no_shift when shiftStatus is missing or invalid', () => {
    const data = buildHeroData(
      { workerName: 'Asha M.' },
      null,
      'Asha M.',
      'en',
    )
    expect(data.shiftStatus).toBe('no_shift')
    expect(data.nextTask).toBeNull()
  })

  it('prefers swahili role label when locale is sw', () => {
    const data = buildHeroData(
      { roleLabel: 'Pit operator', roleLabelSw: 'Mchimbaji wa shimo' },
      null,
      'Asha',
      'sw',
    )
    expect(data.roleLabel).toBe('Mchimbaji wa shimo')
  })

  it('returns a populated next task when ids and titles are present', () => {
    const data = buildHeroData(
      { shiftStatus: 'active' },
      {
        id: 'task-7',
        titleEn: 'Inspect generator',
        titleSw: 'Kagua jenereta',
        location: 'Camp · A2',
        startedAt: '2026-05-29T08:00:00Z',
      },
      'Asha',
      'en',
    )
    expect(data.nextTask?.id).toBe('task-7')
    expect(data.nextTask?.location).toBe('Camp · A2')
    expect(data.nextTask?.startedAt).toBe('2026-05-29T08:00:00Z')
  })

  it('rejects a partial task with missing titles', () => {
    const data = buildHeroData(
      { shiftStatus: 'active' },
      { id: 'task-7' },
      'Asha',
      'en',
    )
    expect(data.nextTask).toBeNull()
  })

  it('uses the fallback name when me payload omits worker name', () => {
    const data = buildHeroData(null, null, 'Asha M.', 'en')
    expect(data.workerName).toBe('Asha M.')
  })

  it('passes through shiftDetail when present', () => {
    const data = buildHeroData(
      { shiftDetail: 'Morning 06:00–14:00', shiftStatus: 'active' },
      null,
      'Asha',
      'en',
    )
    expect(data.shiftDetail).toBe('Morning 06:00–14:00')
  })
})
