import { apiFetch } from './client'
import { withMockFallback } from './withFallback'
import { findDocument, mockDocuments } from '@/mocks/documents'
import type { SaleDocument } from '@/types/document'

export async function fetchDocuments(): Promise<readonly SaleDocument[]> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: readonly SaleDocument[] }>('/api/v1/documents')
      return response.data
    },
    () => mockDocuments
  )
}

export async function fetchDocument(id: string): Promise<SaleDocument | undefined> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: SaleDocument }>(`/api/v1/documents/${encodeURIComponent(id)}`)
      return response.data
    },
    () => findDocument(id)
  )
}

export interface SignDocumentInput {
  readonly documentId: string
  readonly biometricToken: string
}

export async function signDocument(input: SignDocumentInput): Promise<SaleDocument | undefined> {
  return withMockFallback(
    async () => {
      const response = await apiFetch<{ readonly data: SaleDocument }>(
        `/api/v1/documents/${encodeURIComponent(input.documentId)}/sign`,
        {
          method: 'POST',
          body: { biometricToken: input.biometricToken }
        }
      )
      return response.data
    },
    () => {
      const existing = findDocument(input.documentId)
      if (!existing) {
        return undefined
      }
      return {
        ...existing,
        status: 'signed',
        signedAt: new Date().toISOString()
      }
    }
  )
}
