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
      apiRequestOrFallback<ReadonlyArray<DocumentRecord>>(
        '/api/v1/owner/documents',
        DOCUMENTS_MOCK,
        { signal },
      ),
  });
}
