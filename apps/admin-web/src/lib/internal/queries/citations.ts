/**
 * react-query bindings for /api/v1/mining/internal/citations.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/citations.hono.ts):
 *   GET  /                    searchable regulation index
 *   query: source?, q?, language?, limit?
 *
 * The live row shape comes from `intelligence_corpus_chunks` (id /
 * sourceFile / section / text / metadata / ingestedAt / url). The
 * adapter shims that into the legacy `Citation` shape used by the
 * citations panel.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Citation, CitationSource } from '@/lib/internal/types';

const KEY = ['internal', 'citations'] as const;

interface CitationsResult {
  readonly rows: ReadonlyArray<Citation>;
  readonly source: 'live';
}

interface RawCorpusChunk {
  readonly id?: string;
  readonly sourceFile?: string;
  readonly section?: string | null;
  readonly text?: string;
  readonly url?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly ingestedAt?: string;
}

const SOURCE_LABELS: Record<string, CitationSource> = {
  gazette: 'Gazette',
  nemc: 'NEMC',
  bot: 'BoT',
  tra: 'TRA',
  tumemadini: 'Tumemadini',
  tmaa: 'TMAA',
};

function resolveSource(raw: RawCorpusChunk): CitationSource {
  const meta = raw.metadata as { source?: string } | null | undefined;
  const tag = (meta?.source ?? '').toLowerCase();
  if (tag && SOURCE_LABELS[tag]) return SOURCE_LABELS[tag]!;
  const path = (raw.sourceFile ?? '').toLowerCase();
  for (const key of Object.keys(SOURCE_LABELS)) {
    if (path.includes(key)) return SOURCE_LABELS[key]!;
  }
  return 'Gazette';
}

function adaptChunk(raw: RawCorpusChunk): Citation {
  const text = raw.text ?? '';
  return {
    id: raw.id ?? `cit_${Math.random().toString(36).slice(2)}`,
    statute: raw.sourceFile ?? 'unknown',
    section: raw.section ?? '',
    publishedOn: raw.ingestedAt ?? new Date().toISOString(),
    source: resolveSource(raw),
    excerpt: text.length > 400 ? `${text.slice(0, 400)}...` : text,
  };
}

export function useCitationsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CitationsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawCorpusChunk>>('/citations');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptChunk), source: 'live' };
    },
  });
}
