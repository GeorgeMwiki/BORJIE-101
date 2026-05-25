'use client';

import { CorpusDropZone } from './CorpusDropZone';
import { CorpusList } from './CorpusList';
import { DataSourceBadge } from '../DataSourceBadge';
import { useCorpusQuery } from '@/lib/internal/queries/corpus';

export function CorpusManagement(): JSX.Element {
  const query = useCorpusQuery();

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading corpus…</p>;
  if (query.isError) return <p className="text-sm text-danger">Corpus unavailable: {query.error.message}</p>;

  return (
    <div className="space-y-4">
      <CorpusDropZone />
      <CorpusList rows={query.data.rows} />
      <div>
        <DataSourceBadge source={query.data.source} />
      </div>
    </div>
  );
}
