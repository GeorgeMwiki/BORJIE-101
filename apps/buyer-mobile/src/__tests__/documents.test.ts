import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  ingestionStatusLabel,
  kindLabel,
  validateUpload,
} from '../documents/types'

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
  it('returns English status labels', () => {
    expect(ingestionStatusLabel('queued')).toBe('Queued')
    expect(ingestionStatusLabel('processing')).toBe('Processing')
    expect(ingestionStatusLabel('ready')).toBe('Ready')
    expect(ingestionStatusLabel('failed')).toBe('Failed')
  })

  it('returns English kind labels', () => {
    expect(kindLabel('contract')).toBe('Contract')
    expect(kindLabel('rfp')).toBe('RFP / Tender')
    expect(kindLabel('letter')).toBe('Letter')
    expect(kindLabel('report')).toBe('Report')
    expect(kindLabel('other')).toBe('Other')
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
