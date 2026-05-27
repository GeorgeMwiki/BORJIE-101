import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  ingestionStatusLabel,
  kindLabel,
  validateUpload,
} from '../documents/types'

/**
 * Pure-data tests for the documents module. We exercise:
 *
 *   - The validation helper (mime allow-list, size cap, empty payload).
 *   - The bilingual chip-label helpers (sw default, en branch).
 *   - The constants ship a non-empty mime list with PDF + DOCX coverage.
 */

describe('documents.validateUpload', () => {
  it('rejects an empty filename', () => {
    const result = validateUpload({
      fileName: '',
      mimeType: 'application/pdf',
      fileSize: 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('FILE_NAME_REQUIRED')
    }
  })

  it('rejects a disallowed mime type', () => {
    const result = validateUpload({
      fileName: 'malware.exe',
      mimeType: 'application/x-msdownload',
      fileSize: 1024,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('MIME_NOT_ALLOWED')
    }
  })

  it('rejects an empty file (size 0)', () => {
    const result = validateUpload({
      fileName: 'empty.pdf',
      mimeType: 'application/pdf',
      fileSize: 0,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('FILE_EMPTY')
    }
  })

  it('rejects a file exceeding 25 MB', () => {
    const result = validateUpload({
      fileName: 'big.pdf',
      mimeType: 'application/pdf',
      fileSize: MAX_FILE_BYTES + 1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('FILE_TOO_LARGE')
    }
  })

  it('accepts a valid PDF under the size cap', () => {
    const result = validateUpload({
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024 * 1024,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts a JPEG photo', () => {
    const result = validateUpload({
      fileName: 'doc-photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 4096,
    })
    expect(result.ok).toBe(true)
  })
})

describe('documents.ingestionStatusLabel', () => {
  it('returns Swahili-first labels by default', () => {
    expect(ingestionStatusLabel('queued')).toBe('Imewekwa kwenye foleni')
    expect(ingestionStatusLabel('ready')).toBe('Tayari')
    expect(ingestionStatusLabel('failed')).toBe('Imeshindikana')
  })

  it('switches to English when requested', () => {
    expect(ingestionStatusLabel('queued', 'en')).toBe('Queued')
    expect(ingestionStatusLabel('ready', 'en')).toBe('Ready')
  })
})

describe('documents.kindLabel', () => {
  it('returns Swahili-first labels by default', () => {
    expect(kindLabel('contract')).toBe('Mkataba')
    expect(kindLabel('rfp')).toBe('Zabuni')
    expect(kindLabel('letter')).toBe('Barua')
    expect(kindLabel('report')).toBe('Ripoti')
    expect(kindLabel('other')).toBe('Nyingine')
  })

  it('switches to English when requested', () => {
    expect(kindLabel('contract', 'en')).toBe('Contract')
    expect(kindLabel('rfp', 'en')).toBe('RFP / Tender')
  })
})

describe('documents.ALLOWED_MIMES', () => {
  it('includes PDF and DOCX', () => {
    expect(ALLOWED_MIMES).toContain('application/pdf')
    expect(ALLOWED_MIMES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('includes at least one image mime', () => {
    const images = ALLOWED_MIMES.filter((m) => m.startsWith('image/'))
    expect(images.length).toBeGreaterThan(0)
  })
})
