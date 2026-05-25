import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_AUDIT_LOG } from '@/lib/mocks/audit-log';
import type { AuditEvent } from '@/lib/mocks/types';

const KEY = ['internal', 'audit-log'] as const;

interface AuditLogResult {
  readonly rows: ReadonlyArray<AuditEvent>;
  readonly source: 'live' | 'mock';
}

export function useAuditLogQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AuditLogResult> => {
      const res = await apiClient.get<ReadonlyArray<AuditEvent>>('/audit-log', async () => MOCK_AUDIT_LOG);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}
