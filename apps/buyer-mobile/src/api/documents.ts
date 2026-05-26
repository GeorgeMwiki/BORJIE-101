import { apiFetch } from './client'
import type { SaleDocument } from '@/types/document'

export async function fetchDocuments(): Promise<readonly SaleDocument[]> {
  const response = await apiFetch<{ readonly data: readonly SaleDocument[] }>(
    '/api/v1/documents'
  )
  return response.data
}

export async function fetchDocument(id: string): Promise<SaleDocument | undefined> {
  const response = await apiFetch<{ readonly data: SaleDocument }>(
    `/api/v1/documents/${encodeURIComponent(id)}`
  )
  return response.data
}

export interface SignDocumentInput {
  readonly documentId: string
  readonly biometricToken: string
}

export async function signDocument(input: SignDocumentInput): Promise<SaleDocument | undefined> {
  const response = await apiFetch<{ readonly data: SaleDocument }>(
    `/api/v1/documents/${encodeURIComponent(input.documentId)}/sign`,
    {
      method: 'POST',
      body: { biometricToken: input.biometricToken }
    }
  )
  return response.data
}
