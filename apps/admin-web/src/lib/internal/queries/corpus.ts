import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_CORPUS } from '@/lib/mocks/corpus';
import type { CorpusEntry } from '@/lib/mocks/types';

const KEY = ['internal', 'corpus'] as const;

interface CorpusResult {
  readonly rows: ReadonlyArray<CorpusEntry>;
  readonly source: 'live' | 'mock';
}

export function useCorpusQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CorpusResult> => {
      const res = await apiClient.get<ReadonlyArray<CorpusEntry>>('/corpus', async () => MOCK_CORPUS);
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data, source: res.source };
    },
  });
}

export function useSupersedeCorpus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<CorpusEntry> => {
      const res = await apiClient.post<CorpusEntry>(`/corpus/${id}/supersede`, {}, async () => {
        const hit = MOCK_CORPUS.find((e) => e.id === id);
        if (!hit) throw new Error('Entry not found');
        return { ...hit, status: 'Superseded' };
      });
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<CorpusResult>(KEY);
      if (prev) {
        qc.setQueryData<CorpusResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, status: 'Superseded' } : r)),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

interface UploadInput {
  readonly name: string;
  readonly bytes: number;
}

export function useUploadCorpus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput): Promise<CorpusEntry> => {
      const res = await apiClient.post<CorpusEntry>('/corpus/upload', input, async () => ({
        id: `doc_${Math.random().toString(36).slice(2, 9)}`,
        title: input.name,
        version: 'v1.0',
        status: 'Re-ingesting',
        bytes: input.bytes,
        indexedAt: new Date().toISOString(),
        chunks: Math.max(1, Math.round(input.bytes / 12_000)),
      }));
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onSuccess: (entry) => {
      const prev = qc.getQueryData<CorpusResult>(KEY);
      if (prev) {
        qc.setQueryData<CorpusResult>(KEY, { ...prev, rows: [entry, ...prev.rows] });
      } else {
        qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });
}
