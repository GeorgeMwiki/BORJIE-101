/**
 * Worker leave requests — pure helpers (WS-3 workforce wires).
 *
 * No JSX so the workforce-mobile node vitest suite can exercise the validation
 * + bilingual labelling cold; the `.tsx` screen renders what these produce and
 * POSTs the payload `buildSubmitPayload` returns to
 * POST /api/v1/mining/leave-requests.
 */

export type Lang = 'sw' | 'en'

export const LEAVE_CATEGORIES = [
  'annual',
  'sick',
  'unpaid',
  'bereavement',
  'maternity',
  'paternity',
  'other',
] as const

export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number]

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveRequestRow {
  readonly id: string
  readonly category: LeaveCategory
  readonly startOn: string
  readonly endOn: string
  readonly reason: string | null
  readonly status: LeaveStatus
  readonly decisionNote: string | null
  readonly submittedAt: string
}

export interface LeaveSubmitInput {
  readonly category: LeaveCategory
  readonly startOn: string
  readonly endOn: string
  readonly reason?: string
}

export interface LeaveSubmitPayload {
  readonly category: LeaveCategory
  readonly startOn: string
  readonly endOn: string
  readonly reason?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Bilingual category labels. */
const CATEGORY_LABELS: Readonly<Record<LeaveCategory, { sw: string; en: string }>> = {
  annual: { sw: 'Likizo ya mwaka', en: 'Annual leave' },
  sick: { sw: 'Ugonjwa', en: 'Sick leave' },
  unpaid: { sw: 'Bila malipo', en: 'Unpaid leave' },
  bereavement: { sw: 'Msiba', en: 'Bereavement' },
  maternity: { sw: 'Uzazi (mama)', en: 'Maternity' },
  paternity: { sw: 'Uzazi (baba)', en: 'Paternity' },
  other: { sw: 'Nyingine', en: 'Other' },
}

/** Bilingual status labels. */
const STATUS_LABELS: Readonly<Record<LeaveStatus, { sw: string; en: string }>> = {
  pending: { sw: 'Inasubiri', en: 'Pending' },
  approved: { sw: 'Imeidhinishwa', en: 'Approved' },
  rejected: { sw: 'Imekataliwa', en: 'Rejected' },
}

export function categoryLabel(category: LeaveCategory, lang: Lang): string {
  const entry = CATEGORY_LABELS[category]
  return lang === 'sw' ? entry.sw : entry.en
}

export function statusLabel(status: LeaveStatus, lang: Lang): string {
  const entry = STATUS_LABELS[status]
  return lang === 'sw' ? entry.sw : entry.en
}

/** Tone for the status pill — drives colour in the renderer. */
export function statusTone(status: LeaveStatus): 'warn' | 'success' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warn'
}

export type LeaveValidation =
  | { readonly ok: true; readonly payload: LeaveSubmitPayload }
  | { readonly ok: false; readonly error: string }

/**
 * Validate + normalise the submit form. Mirrors the server zod rules so the FE
 * fails fast (well-formed dates + end >= start + known category) before the
 * round-trip; the server still re-validates authoritatively.
 */
export function buildSubmitPayload(
  input: LeaveSubmitInput,
  lang: Lang = 'en',
): LeaveValidation {
  const isSw = lang === 'sw'
  if (!LEAVE_CATEGORIES.includes(input.category)) {
    return { ok: false, error: isSw ? 'Aina si sahihi' : 'Invalid category' }
  }
  if (!DATE_RE.test(input.startOn) || !DATE_RE.test(input.endOn)) {
    return {
      ok: false,
      error: isSw ? 'Tarehe lazima iwe YYYY-MM-DD' : 'Dates must be YYYY-MM-DD',
    }
  }
  if (input.endOn < input.startOn) {
    return {
      ok: false,
      error: isSw
        ? 'Tarehe ya mwisho lazima isiwe kabla ya kuanza'
        : 'End date must not be before the start date',
    }
  }
  const reason = input.reason?.trim()
  return {
    ok: true,
    payload: {
      category: input.category,
      startOn: input.startOn,
      endOn: input.endOn,
      ...(reason ? { reason } : {}),
    },
  }
}
