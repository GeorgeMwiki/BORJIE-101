import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { SaleDocument } from '@/types/document'

const DOCUMENTS_PREFIX = `${MINING_PREFIX}/buyers/documents`

export async function fetchDocuments(): Promise<readonly SaleDocument[]> {
  const response = await apiFetch<{ readonly data: readonly SaleDocument[] }>(
    DOCUMENTS_PREFIX
  )
  return response.data
}

export async function fetchDocument(id: string): Promise<SaleDocument | undefined> {
  const response = await apiFetch<{ readonly data: SaleDocument }>(
    `${DOCUMENTS_PREFIX}/${encodeURIComponent(id)}`
  )
  return response.data
}

export interface SignDocumentInput {
  readonly documentId: string
  readonly biometricToken: string
}

export async function signDocument(input: SignDocumentInput): Promise<SaleDocument | undefined> {
  const response = await apiFetch<{ readonly data: SaleDocument }>(
    `${DOCUMENTS_PREFIX}/${encodeURIComponent(input.documentId)}/sign`,
    {
      method: 'POST',
      body: { biometricToken: input.biometricToken }
    }
  )
  return response.data
}
