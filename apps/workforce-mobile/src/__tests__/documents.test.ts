import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  ingestionStatusLabel,
  kindLabel,
  validateUpload,
} from '../documents/types'
import { pickStrings } from '../i18n'

/**
 * Pure-data tests for the documents module. We exercise:
 *
 *   - The validation helper (mime allow-list, size cap, empty payload).
 *   - The chip-label helpers resolve a SINGLE-LOCALE label from the active
 *     dictionary (no EN+SW mixing) — `sw` and `en` each render only their
 *     own catalog value.
 *   - The constants ship a non-empty mime list with PDF + DOCX coverage.
 */

const sw = pickStrings('sw')
const en = pickStrings('en')

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
  it('resolves Swahili labels from the sw dictionary', () => {
    expect(ingestionStatusLabel('queued', sw)).toBe('Imewekwa kwenye foleni')
    expect(ingestionStatusLabel('processing', sw)).toBe('Inachakatwa')
    expect(ingestionStatusLabel('ready', sw)).toBe('Tayari')
    expect(ingestionStatusLabel('failed', sw)).toBe('Imeshindikana')
  })

  it('resolves English labels from the en dictionary', () => {
    expect(ingestionStatusLabel('queued', en)).toBe('Queued')
    expect(ingestionStatusLabel('processing', en)).toBe('Processing')
    expect(ingestionStatusLabel('ready', en)).toBe('Ready')
    expect(ingestionStatusLabel('failed', en)).toBe('Failed')
  })
})

describe('documents.kindLabel', () => {
  it('resolves Swahili labels from the sw dictionary', () => {
    expect(kindLabel('contract', sw)).toBe('Mkataba')
    expect(kindLabel('rfp', sw)).toBe('Zabuni')
    expect(kindLabel('letter', sw)).toBe('Barua')
    expect(kindLabel('report', sw)).toBe('Ripoti')
    expect(kindLabel('other', sw)).toBe('Nyingine')
  })

  it('resolves English labels from the en dictionary', () => {
    expect(kindLabel('contract', en)).toBe('Contract')
    expect(kindLabel('rfp', en)).toBe('RFP / Tender')
    expect(kindLabel('letter', en)).toBe('Letter')
    expect(kindLabel('report', en)).toBe('Report')
    expect(kindLabel('other', en)).toBe('Other')
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
