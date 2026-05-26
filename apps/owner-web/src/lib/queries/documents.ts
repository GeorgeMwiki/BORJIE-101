'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { DOCUMENTS_MOCK, type DocumentRecord } from '@/lib/mocks/documents';

export const documentKeys = {
  all: ['documents'] as const,
  list: () => [...documentKeys.all, 'list'] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
};

export function useDocumentList() {
  return useQuery({
    queryKey: documentKeys.list(),
    queryFn: ({ signal }) =>
      // Live endpoint: GET /api/v1/mining/documents
      // (services/api-gateway/src/routes/mining/documents.hono.ts).
      apiRequestOrFallback<ReadonlyArray<DocumentRecord>>(
        '/api/v1/mining/documents',
        DOCUMENTS_MOCK,
        { signal },
      ),
  });
}
