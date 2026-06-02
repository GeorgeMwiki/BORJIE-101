/**
 * Worker leave-request helper tests (WS-3). Pure node, no JSX. Proves the
 * submit payload validation mirrors the server zod rules and that category /
 * status labelling is bilingual with no EN/SW mixing.
 */

import { describe, expect, it } from 'vitest'

import {
  buildSubmitPayload,
  categoryLabel,
  LEAVE_CATEGORIES,
  statusLabel,
  statusTone,
  type LeaveCategory,
  type LeaveStatus,
} from '../leave/leave.helpers'

describe('buildSubmitPayload', () => {
  it('accepts a well-formed request and trims the reason', () => {
    const res = buildSubmitPayload({
      category: 'sick',
      startOn: '2026-06-10',
      endOn: '2026-06-12',
      reason: '  Malaria  ',
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.payload).toEqual({
        category: 'sick',
        startOn: '2026-06-10',
        endOn: '2026-06-12',
        reason: 'Malaria',
      })
    }
  })

  it('omits an empty reason from the payload', () => {
    const res = buildSubmitPayload({
      category: 'annual',
      startOn: '2026-06-10',
      endOn: '2026-06-10',
      reason: '   ',
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect('reason' in res.payload).toBe(false)
    }
  })

  it('rejects an end-before-start range (matches the server CHECK + zod refine)', () => {
    const res = buildSubmitPayload({
      category: 'annual',
      startOn: '2026-06-12',
      endOn: '2026-06-10',
    })
    expect(res.ok).toBe(false)
  })

  it('rejects malformed dates', () => {
    expect(buildSubmitPayload({ category: 'annual', startOn: '06/10/2026', endOn: '2026-06-12' }).ok).toBe(false)
  })

  it('rejects an unknown category', () => {
    expect(
      buildSubmitPayload({
        category: 'sabbatical' as LeaveCategory,
        startOn: '2026-06-10',
        endOn: '2026-06-12',
      }).ok,
    ).toBe(false)
  })

  it('returns a Swahili error when lang=sw (no EN/SW mixing)', () => {
    const res = buildSubmitPayload(
      { category: 'annual', startOn: '2026-06-12', endOn: '2026-06-10' },
      'sw',
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).not.toMatch(/[A-Za-z]{4,}\s(date|leave|category)/)
      expect(res.error.length).toBeGreaterThan(0)
    }
  })
})

describe('category + status labelling', () => {
  it('labels every category bilingually', () => {
    for (const c of LEAVE_CATEGORIES) {
      expect(categoryLabel(c, 'sw').length).toBeGreaterThan(0)
      expect(categoryLabel(c, 'en').length).toBeGreaterThan(0)
      // EN and SW differ (proves both are real translations).
      expect(categoryLabel(c, 'sw')).not.toBe(categoryLabel(c, 'en'))
    }
  })

  it('labels every status bilingually with a tone', () => {
    const statuses: ReadonlyArray<LeaveStatus> = ['pending', 'approved', 'rejected']
    for (const s of statuses) {
      expect(statusLabel(s, 'sw').length).toBeGreaterThan(0)
      expect(statusLabel(s, 'en').length).toBeGreaterThan(0)
    }
    expect(statusTone('approved')).toBe('success')
    expect(statusTone('rejected')).toBe('danger')
    expect(statusTone('pending')).toBe('warn')
  })
})
