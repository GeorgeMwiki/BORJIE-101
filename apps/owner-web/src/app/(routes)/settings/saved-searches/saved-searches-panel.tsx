'use client';

/**
 * Client panel for the saved-searches settings page.
 *
 * - GET /api/v1/owner/saved-searches → list
 * - POST /api/v1/owner/saved-searches → create
 * - DELETE /api/v1/owner/saved-searches/:id → soft-delete
 *
 * Bilingual sw/en labels. No optimistic mutations — we always re-fetch
 * after a write so the UI shows the server-canonical state.
 */

import { useCallback, useEffect, useState } from 'react';

import { apiRequest } from '@/lib/api-client';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { useLocale, pickByLocale } from '@/lib/locale';
import {
  Button,
  Skeleton,
  Input,
  Textarea,
  FormField,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';

interface SavedSearch {
  readonly id: string;
  readonly label: string;
  readonly frequency: 'hourly' | 'daily' | 'weekly';
  readonly source: 'marketplace' | 'opportunities' | 'regulatory';
  readonly queryJson: Record<string, unknown>;
  readonly lastRunAt: string | null;
  readonly lastMatchCount: number;
  readonly createdAt: string;
}

const FREQUENCY_LABELS_EN: Record<SavedSearch['frequency'], string> = {
  hourly: S.savedSearches.frequencyHourly.en,
  daily: S.savedSearches.frequencyDaily.en,
  weekly: S.savedSearches.frequencyWeekly.en,
};

const FREQUENCY_LABELS_SW: Record<SavedSearch['frequency'], string> = {
  hourly: S.savedSearches.frequencyHourly.sw,
  daily: S.savedSearches.frequencyDaily.sw,
  weekly: S.savedSearches.frequencyWeekly.sw,
};

const SOURCE_LABELS_EN: Record<SavedSearch['source'], string> = {
  marketplace: S.savedSearches.sourceMarketplace.en,
  opportunities: S.savedSearches.sourceOpportunities.en,
  regulatory: S.savedSearches.sourceRegulatory.en,
};

const SOURCE_LABELS_SW: Record<SavedSearch['source'], string> = {
  marketplace: S.savedSearches.sourceMarketplace.sw,
  opportunities: S.savedSearches.sourceOpportunities.sw,
  regulatory: S.savedSearches.sourceRegulatory.sw,
};

export function SavedSearchesPanel() {
  const locale = useLocale();
  const [items, setItems] = useState<ReadonlyArray<SavedSearch>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<string>('');
  const [queryText, setQueryText] = useState<string>('{}');
  const [frequency, setFrequency] = useState<SavedSearch['frequency']>('daily');
  const [source, setSource] = useState<SavedSearch['source']>('marketplace');
  const [creating, setCreating] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // apiRequest prepends the gateway base, attaches the Supabase Bearer,
      // and unwraps the {success,data} envelope — so this is the list array.
      const data = await apiRequest<ReadonlyArray<SavedSearch>>(
        '/api/v1/owner/saved-searches',
        { method: 'GET' },
      );
      setItems(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    setCreating(true);
    setError(null);
    let parsedQuery: Record<string, unknown>;
    try {
      parsedQuery = queryText.trim() ? JSON.parse(queryText) : {};
    } catch {
      setError('Query JSON is invalid');
      setCreating(false);
      return;
    }
    try {
      await apiRequest('/api/v1/owner/saved-searches', {
        method: 'POST',
        body: {
          label,
          queryJson: parsedQuery,
          frequency,
          source,
        },
      });
      setLabel('');
      setQueryText('{}');
      setFrequency('daily');
      setSource('marketplace');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [label, queryText, frequency, source, refresh]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiRequest(`/api/v1/owner/saved-searches/${id}`, {
          method: 'DELETE',
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh],
  );

  return (
    <section className="mt-6 space-y-6">
      <form
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, { en: 'New saved search', sw: 'Utafutaji mpya' })}
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.savedSearches.newSearchTagline)}
        </p>
        <FormField label={pickByLocale(locale, S.savedSearches.labelField)}>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={120}
            placeholder="Gold 22k+ Geita"
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.savedSearches.queryField)}>
          <Textarea
            className="h-24 font-mono text-xs"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder='{"commodity":"gold","minPurity":22,"region":"geita"}'
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={pickByLocale(locale, S.savedSearches.frequencyField)}>
            <Select
              value={frequency}
              onValueChange={(v) => setFrequency(v as SavedSearch['frequency'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">
                  {pickByLocale(locale, S.savedSearches.frequencyHourly)}
                </SelectItem>
                <SelectItem value="daily">
                  {pickByLocale(locale, S.savedSearches.frequencyDaily)}
                </SelectItem>
                <SelectItem value="weekly">
                  {pickByLocale(locale, S.savedSearches.frequencyWeekly)}
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={pickByLocale(locale, S.savedSearches.sourceField)}>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as SavedSearch['source'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketplace">
                  {pickByLocale(locale, S.savedSearches.sourceMarketplace)}
                </SelectItem>
                <SelectItem value="opportunities">
                  {pickByLocale(locale, S.savedSearches.sourceOpportunities)}
                </SelectItem>
                <SelectItem value="regulatory">
                  {pickByLocale(locale, S.savedSearches.sourceRegulatory)}
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <Button
          type="submit"
          loading={creating}
          disabled={creating || !label.trim()}
        >
          {creating
            ? pickByLocale(locale, { en: 'Saving…', sw: 'Inahifadhi…' })
            : pickByLocale(locale, S.savedSearches.save)}
        </Button>
        {error ? (
          <p className="text-sm text-destructive">
            {pickByLocale(locale, { en: 'Error: ', sw: 'Hitilafu: ' })}
            {error}
          </p>
        ) : null}
      </form>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, {
            en: 'Your saved searches',
            sw: 'Utafutaji wako uliohifadhiwa',
          })}
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.savedSearches.savedListTagline)}
        </p>
        {loading ? (
          <div
            className="mt-4 space-y-2"
            role="status"
            aria-label={pickByLocale(locale, { en: 'Loading…', sw: 'Inapakia…' })}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg border border-border" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4">
            <ScreenEmptyState
              title={pickByLocale(locale, {
                en: 'Your saved searches',
                sw: 'Utafutaji wako uliohifadhiwa',
              })}
              description={pickByLocale(locale, S.savedSearches.emptyList)}
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((item) => {
              const freqLabel = pickByLocale(locale, {
                en: FREQUENCY_LABELS_EN[item.frequency],
                sw: FREQUENCY_LABELS_SW[item.frequency],
              });
              const srcLabel = pickByLocale(locale, {
                en: SOURCE_LABELS_EN[item.source],
                sw: SOURCE_LABELS_SW[item.source],
              });
              const lastRunLabel = item.lastRunAt
                ? pickByLocale(locale, {
                    en: `last ${new Date(item.lastRunAt).toLocaleString()}`,
                    sw: `mwisho ${new Date(item.lastRunAt).toLocaleString()}`,
                  })
                : pickByLocale(locale, {
                    en: 'not yet run',
                    sw: 'haijatekelezwa bado',
                  });
              const matchesLabel = pickByLocale(locale, {
                en: `${item.lastMatchCount} matches`,
                sw: `${item.lastMatchCount} mechi`,
              });
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded border border-border bg-background p-3"
                >
                  <div>
                    <p className="font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {srcLabel} · {freqLabel} · {lastRunLabel} · {matchesLabel}
                    </p>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-surface p-2 text-xxs text-muted-foreground">
                      {JSON.stringify(item.queryJson, null, 0)}
                    </pre>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void remove(item.id)}
                  >
                    {pickByLocale(locale, S.savedSearches.delete)}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
