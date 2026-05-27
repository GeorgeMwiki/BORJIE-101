/**
 * Workforce-mobile wire client for /api/v1/mining/document-intelligence.
 *
 * Builds on the canonical `miningApi` helpers in `../api/client.ts` so the
 * bearer token, timeouts, and error envelope are handled identically to
 * every other mining surface.
 */

import { miningApi } from '../api/client'
import type {
  AskResponse,
  DocumentSession,
  SummaryResponse,
  UploadResult,
  UploadedDocument,
} from './types'

interface Envelope<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: { readonly code?: string; readonly message?: string }
}

export interface UploadInput {
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly textSample?: string
  readonly tags?: ReadonlyArray<string>
}

export async function registerUpload(input: UploadInput): Promise<UploadResult> {
  const response = await miningApi.post<Envelope<UploadResult>>(
    '/document-intelligence/upload',
    input,
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Upload failed')
  }
  return response.data
}

export async function listDocuments(limit = 50): Promise<ReadonlyArray<UploadedDocument>> {
  const response = await miningApi.get<Envelope<{ documents: ReadonlyArray<UploadedDocument> }>>(
    `/document-intelligence/documents?limit=${encodeURIComponent(String(limit))}`,
  )
  if (!response.success || !response.data) {
    return []
  }
  return response.data.documents
}

export interface CreateSessionInput {
  readonly documentIds: ReadonlyArray<string>
  readonly initialPrompt?: string
  readonly title?: string
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{ readonly sessionId: string; readonly session: DocumentSession }> {
  const response = await miningApi.post<
    Envelope<{ sessionId: string; session: DocumentSession }>
  >('/document-intelligence/sessions', input)
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Failed to open session')
  }
  return response.data
}

export interface AskInput {
  readonly sessionId: string
  readonly question: string
  readonly language?: 'sw' | 'en'
}

export async function askSession(input: AskInput): Promise<AskResponse> {
  const response = await miningApi.post<Envelope<AskResponse>>(
    `/document-intelligence/sessions/${encodeURIComponent(input.sessionId)}/ask`,
    { question: input.question, language: input.language ?? 'sw' },
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Ask failed')
  }
  return response.data
}

export interface SummaryInput {
  readonly documentId: string
  readonly language?: 'sw' | 'en'
}

export async function summariseDocument(input: SummaryInput): Promise<SummaryResponse> {
  const response = await miningApi.post<Envelope<SummaryResponse>>(
    `/document-intelligence/documents/${encodeURIComponent(input.documentId)}/summary`,
    { language: input.language ?? 'sw' },
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Summary failed')
  }
  return response.data
}
