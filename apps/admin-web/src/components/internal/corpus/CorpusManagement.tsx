'use client';

import { Skeleton } from '@borjie/design-system';
import { CorpusDropZone } from './CorpusDropZone';
import { CorpusList } from './CorpusList';
import { DataSourceBadge } from '../DataSourceBadge';
import { useCorpusQuery } from '@/lib/internal/queries/corpus';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

const S = {
  unavailable: { en: 'Corpus unavailable', sw: 'Hifadhi haipatikani' },
} as const;

export function CorpusManagement({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useCorpusQuery();

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="text-sm text-danger">
        {pickByLocale(locale, S.unavailable)}: {localizeApiError(query.error, locale)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <CorpusDropZone initialLocale={locale} />
      <CorpusList rows={query.data.rows} initialLocale={locale} />
      <div>
        <DataSourceBadge source={query.data.source} locale={locale} />
      </div>
    </div>
  );
}
