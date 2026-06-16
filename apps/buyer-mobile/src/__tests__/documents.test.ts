import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  ingestionStatusLabel,
  kindLabel,
  validateUpload,
} from '../documents/types'
import { translate } from '../i18n'

const tEn = (path: string): string => translate('en', path)
const tSw = (path: string): string => translate('sw', path)

/**
 * Pure-data tests for the buyer-mobile documents module.
 */

describe('buyer-mobile documents.validateUpload', () => {
  it('rejects an empty filename', () => {
    const r = validateUpload({ fileName: '', mimeType: 'application/pdf', fileSize: 1024 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('FILE_NAME_REQUIRED')
  })

  it('rejects a disallowed mime type', () => {
    const r = validateUpload({
      fileName: 'app.exe',
      mimeType: 'application/x-msdownload',
      fileSize: 1024,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('MIME_NOT_ALLOWED')
  })

  it('rejects a size of 0', () => {
    const r = validateUpload({
      fileName: 'empty.pdf',
      mimeType: 'application/pdf',
      fileSize: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('FILE_EMPTY')
  })

  it('rejects sizes over 25 MB', () => {
    const r = validateUpload({
      fileName: 'big.pdf',
      mimeType: 'application/pdf',
      fileSize: MAX_FILE_BYTES + 1,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('FILE_TOO_LARGE')
  })

  it('accepts a valid PDF', () => {
    const r = validateUpload({
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 4096,
    })
    expect(r.ok).toBe(true)
  })
})

describe('buyer-mobile documents.label helpers', () => {
  it('resolves status labels through the active locale (en)', () => {
    expect(ingestionStatusLabel('queued', tEn)).toBe('Queued')
    expect(ingestionStatusLabel('processing', tEn)).toBe('Processing')
    expect(ingestionStatusLabel('ready', tEn)).toBe('Ready')
    expect(ingestionStatusLabel('failed', tEn)).toBe('Failed')
  })

  it('resolves kind labels through the active locale (en)', () => {
    expect(kindLabel('contract', tEn)).toBe('Contract')
    expect(kindLabel('rfp', tEn)).toBe('RFP / Tender')
    expect(kindLabel('letter', tEn)).toBe('Letter')
    expect(kindLabel('report', tEn)).toBe('Report')
    expect(kindLabel('other', tEn)).toBe('Other')
  })

  it('returns the Swahili copy when the active locale is sw (single-language)', () => {
    expect(ingestionStatusLabel('ready', tSw)).toBe('Tayari')
    expect(kindLabel('contract', tSw)).toBe('Mkataba')
    // canon: no English token leaks into the Swahili render
    expect(kindLabel('letter', tSw)).not.toBe('Letter')
  })
})

describe('buyer-mobile documents.ALLOWED_MIMES', () => {
  it('covers PDF + DOCX + image mimes', () => {
    expect(ALLOWED_MIMES).toContain('application/pdf')
    expect(ALLOWED_MIMES).toContain('image/jpeg')
    const docx = ALLOWED_MIMES.find((m) => m.includes('wordprocessingml.document'))
    expect(docx).toBeTruthy()
  })
})
