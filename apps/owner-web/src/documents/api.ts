/**
 * Owner-web wire client for /api/v1/mining/document-intelligence.
 *
 * Builds on `apiRequest` so the Supabase bearer token + envelope
 * unwrapping stay identical to every other owner-web API call.
 */

import { apiRequest } from '@/lib/api-client';
import type {
  AskResponse,
  DocumentSession,
  SummaryResponse,
  UploadResult,
  UploadedDocument,
} from './types';

const BASE = '/api/v1/mining/document-intelligence';

export interface UploadInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly textSample?: string;
  readonly tags?: ReadonlyArray<string>;
}

interface UnwrappedEnvelope<T> {
  readonly success?: boolean;
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly data?: T;
}

/**
 * The shared `apiRequest` already unwraps `{success, data}` envelopes
 * when both keys are present. We type the response as the inner T so
 * callers do not need to re-unwrap.
 */
function unwrap<T>(value: T | UnwrappedEnvelope<T>): T {
  if (
    value &&
    typeof value === 'object' &&
    'success' in value &&
    'data' in (value as UnwrappedEnvelope<T>)
  ) {
    const env = value as UnwrappedEnvelope<T>;
    if (env.success === false || !env.data) {
      throw new Error(env.error?.message ?? 'Request failed');
    }
    return env.data;
  }
  return value as T;
}

export async function registerUpload(input: UploadInput): Promise<UploadResult> {
  const data = await apiRequest<UploadResult>(`${BASE}/upload`, {
    method: 'POST',
    body: input,
  });
  return unwrap(data);
}

export async function listDocuments(
  limit = 50,
): Promise<ReadonlyArray<UploadedDocument>> {
  const data = await apiRequest<{ documents: ReadonlyArray<UploadedDocument> }>(
    `${BASE}/documents?limit=${encodeURIComponent(String(limit))}`,
  );
  return unwrap(data).documents;
}

export interface CreateSessionInput {
  readonly documentIds: ReadonlyArray<string>;
  readonly initialPrompt?: string;
  readonly title?: string;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{ readonly sessionId: string; readonly session: DocumentSession }> {
  const data = await apiRequest<{ sessionId: string; session: DocumentSession }>(
    `${BASE}/sessions`,
    { method: 'POST', body: input },
  );
  return unwrap(data);
}

export interface AskInput {
  readonly sessionId: string;
  readonly question: string;
  readonly language?: 'sw' | 'en';
}

export async function askSession(input: AskInput): Promise<AskResponse> {
  const data = await apiRequest<AskResponse>(
    `${BASE}/sessions/${encodeURIComponent(input.sessionId)}/ask`,
    {
      method: 'POST',
      body: { question: input.question, language: input.language ?? 'sw' },
    },
  );
  return unwrap(data);
}

export interface SummaryInput {
  readonly documentId: string;
  readonly language?: 'sw' | 'en';
}

export async function summariseDocument(
  input: SummaryInput,
): Promise<SummaryResponse> {
  const data = await apiRequest<SummaryResponse>(
    `${BASE}/documents/${encodeURIComponent(input.documentId)}/summary`,
    {
      method: 'POST',
      body: { language: input.language ?? 'sw' },
    },
  );
  return unwrap(data);
}
