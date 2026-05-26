/**
 * react-query bindings for /api/v1/mining/internal/corpus.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/corpus.hono.ts):
 *   GET   /versions   list ingested chunks (Borjie-global, tenantId NULL)
 *   POST  /upload     ingest a chunk
 *   POST  /supersede  point an old chunk at a new one
 *
 * Live-only: failures propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { CorpusEntry } from '@/lib/internal/types';

const KEY = ['internal', 'corpus'] as const;

interface CorpusResult {
  readonly rows: ReadonlyArray<CorpusEntry>;
  readonly source: 'live';
}

interface RawCorpusChunk {
  readonly id: string;
  readonly sourceFile?: string;
  readonly section?: string | null;
  readonly page?: number | null;
  readonly language?: string;
  readonly url?: string | null;
  readonly supersededById?: string | null;
  readonly ingestedAt?: string;
}

/**
 * Coerce the gateway's chunk shape into the front-end's `CorpusEntry`
 * so existing components can stay agnostic.
 */
function adaptChunk(raw: RawCorpusChunk, index: number): CorpusEntry {
  return {
    id: raw.id,
    title: raw.sourceFile ?? `chunk_${index}`,
    version: 'v1.0',
    status: raw.supersededById ? 'Superseded' : 'Indexed',
    bytes: 0,
    indexedAt: raw.ingestedAt ?? new Date().toISOString(),
    chunks: 1,
  };
}

export function useCorpusQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CorpusResult> => {
      const res = await apiClient.get<ReadonlyArray<RawCorpusChunk>>('/corpus/versions');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptChunk), source: 'live' };
    },
  });
}

type SupersedeInput = string | { readonly oldChunkId: string; readonly newChunkId?: string };

function normaliseSupersede(input: SupersedeInput): { oldChunkId: string; newChunkId: string } {
  if (typeof input === 'string') {
    return { oldChunkId: input, newChunkId: `${input}_succ_${Date.now()}` };
  }
  return {
    oldChunkId: input.oldChunkId,
    newChunkId: input.newChunkId ?? `${input.oldChunkId}_succ_${Date.now()}`,
  };
}

export function useSupersedeCorpus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (raw: SupersedeInput): Promise<CorpusEntry> => {
      const body = normaliseSupersede(raw);
      const res = await apiClient.post<RawCorpusChunk>('/corpus/supersede', body);
      if (!res.ok) throw new Error(res.message);
      return adaptChunk(res.data, 0);
    },
    onMutate: async (raw) => {
      const { oldChunkId } = normaliseSupersede(raw);
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<CorpusResult>(KEY);
      if (prev) {
        qc.setQueryData<CorpusResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === oldChunkId ? { ...r, status: 'Superseded' } : r)),
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
  readonly text?: string;
}

export function useUploadCorpus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput): Promise<CorpusEntry> => {
      const res = await apiClient.post<RawCorpusChunk>('/corpus/upload', {
        sourceFile: input.name,
        text: input.text ?? `Pending ingest of ${input.name} (${input.bytes} bytes).`,
        language: 'en',
      });
      if (!res.ok) throw new Error(res.message);
      return adaptChunk(res.data, 0);
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
