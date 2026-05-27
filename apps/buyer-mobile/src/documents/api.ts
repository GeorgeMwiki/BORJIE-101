/**
 * Buyer-mobile wire client for /api/v1/mining/document-intelligence.
 *
 * Builds on the apiFetch helper so the bearer token + envelope handling
 * stay identical to every other buyer-mobile API call.
 */

import { apiFetch } from '@/api/client'
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

const BASE = '/api/v1/mining/document-intelligence'

export interface UploadInput {
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly textSample?: string
  readonly tags?: ReadonlyArray<string>
}

export async function registerUpload(input: UploadInput): Promise<UploadResult> {
  const response = await apiFetch<Envelope<UploadResult>>(`${BASE}/upload`, {
    method: 'POST',
    body: input,
  })
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Upload failed')
  }
  return response.data
}

export async function listDocuments(limit = 50): Promise<ReadonlyArray<UploadedDocument>> {
  const response = await apiFetch<Envelope<{ documents: ReadonlyArray<UploadedDocument> }>>(
    `${BASE}/documents?limit=${encodeURIComponent(String(limit))}`,
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
  const response = await apiFetch<Envelope<{ sessionId: string; session: DocumentSession }>>(
    `${BASE}/sessions`,
    { method: 'POST', body: input },
  )
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
  const response = await apiFetch<Envelope<AskResponse>>(
    `${BASE}/sessions/${encodeURIComponent(input.sessionId)}/ask`,
    {
      method: 'POST',
      body: { question: input.question, language: input.language ?? 'en' },
    },
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
  const response = await apiFetch<Envelope<SummaryResponse>>(
    `${BASE}/documents/${encodeURIComponent(input.documentId)}/summary`,
    {
      method: 'POST',
      body: { language: input.language ?? 'en' },
    },
  )
  if (!response.success || !response.data) {
    throw new Error(response.error?.message ?? 'Summary failed')
  }
  return response.data
}
