/**
 * react-query bindings for /api/v1/mining/internal/corpus.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/corpus.hono.ts):
 *   GET   /versions   list ingested chunks (Borjie-global, tenantId NULL)
 *   POST  /upload     ingest a chunk
 *   POST  /supersede  point an old chunk at a new one
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_CORPUS } from '@/lib/mocks/corpus';
import type { CorpusEntry } from '@/lib/mocks/types';

const KEY = ['internal', 'corpus'] as const;

interface CorpusResult {
  readonly rows: ReadonlyArray<CorpusEntry>;
  readonly source: 'live' | 'mock';
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
 * so existing components can stay agnostic. Many fields are not
 * surfaced by the live API yet (bytes / chunks count / version) so we
 * synthesise sensible placeholders that the UI knows how to render.
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
      const res = await apiClient.get<ReadonlyArray<RawCorpusChunk | CorpusEntry>>(
        '/corpus/versions',
        async () => MOCK_CORPUS,
      );
      if (!res.ok) throw new Error(res.message);
      const rows =
        res.source === 'live'
          ? (res.data as ReadonlyArray<RawCorpusChunk>).map(adaptChunk)
          : (res.data as ReadonlyArray<CorpusEntry>);
      return { rows, source: res.source };
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
      const res = await apiClient.post<RawCorpusChunk | CorpusEntry>(
        '/corpus/supersede',
        body,
        async () => {
          const hit = MOCK_CORPUS.find((e) => e.id === body.oldChunkId);
          if (!hit) throw new Error('Entry not found');
          return { ...hit, status: 'Superseded' };
        },
      );
      if (!res.ok) throw new Error(res.message);
      const next =
        res.source === 'live' ? adaptChunk(res.data as RawCorpusChunk, 0) : (res.data as CorpusEntry);
      return next;
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
      const res = await apiClient.post<RawCorpusChunk | CorpusEntry>(
        '/corpus/upload',
        {
          sourceFile: input.name,
          text: input.text ?? `Pending ingest of ${input.name} (${input.bytes} bytes).`,
          language: 'en',
        },
        async () => ({
          id: `doc_${Math.random().toString(36).slice(2, 9)}`,
          title: input.name,
          version: 'v1.0',
          status: 'Re-ingesting',
          bytes: input.bytes,
          indexedAt: new Date().toISOString(),
          chunks: Math.max(1, Math.round(input.bytes / 12_000)),
        }),
      );
      if (!res.ok) throw new Error(res.message);
      return res.source === 'live'
        ? adaptChunk(res.data as RawCorpusChunk, 0)
        : (res.data as CorpusEntry);
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
