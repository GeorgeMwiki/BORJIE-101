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

import { getCsrfHeaders } from '@/lib/csrf';
import { routesBStrings as S } from '@/i18n/strings/routes-b';
import { useLocale, pickByLocale } from '@/lib/locale';

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
      const res = await fetch('/api/v1/owner/saved-searches', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<SavedSearch>;
      };
      setItems(json.data ?? []);
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
      const res = await fetch('/api/v1/owner/saved-searches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getCsrfHeaders() },
        body: JSON.stringify({
          label,
          queryJson: parsedQuery,
          frequency,
          source,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
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
        const res = await fetch(`/api/v1/owner/saved-searches/${id}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { ...getCsrfHeaders() },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
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
        <p className="text-xs italic text-neutral-500">
          {pickByLocale(locale, S.savedSearches.newSearchTagline)}
        </p>
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.savedSearches.labelField)}
          </span>
          <input
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={120}
            placeholder="Gold 22k+ Geita"
          />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-300">
            {pickByLocale(locale, S.savedSearches.queryField)}
          </span>
          <textarea
            className="mt-1 h-24 w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder='{"commodity":"gold","minPurity":22,"region":"geita"}'
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-neutral-300">
              {pickByLocale(locale, S.savedSearches.frequencyField)}
            </span>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as SavedSearch['frequency'])
              }
            >
              <option value="hourly">
                {pickByLocale(locale, S.savedSearches.frequencyHourly)}
              </option>
              <option value="daily">
                {pickByLocale(locale, S.savedSearches.frequencyDaily)}
              </option>
              <option value="weekly">
                {pickByLocale(locale, S.savedSearches.frequencyWeekly)}
              </option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-neutral-300">
              {pickByLocale(locale, S.savedSearches.sourceField)}
            </span>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as SavedSearch['source'])
              }
            >
              <option value="marketplace">
                {pickByLocale(locale, S.savedSearches.sourceMarketplace)}
              </option>
              <option value="opportunities">
                {pickByLocale(locale, S.savedSearches.sourceOpportunities)}
              </option>
              <option value="regulatory">
                {pickByLocale(locale, S.savedSearches.sourceRegulatory)}
              </option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={creating || !label.trim()}
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {creating
            ? pickByLocale(locale, { en: 'Saving…', sw: 'Inahifadhi…' })
            : pickByLocale(locale, S.savedSearches.save)}
        </button>
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
        <p className="text-xs italic text-neutral-500">
          {pickByLocale(locale, S.savedSearches.savedListTagline)}
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-neutral-400">
            {pickByLocale(locale, { en: 'Loading…', sw: 'Inapakia…' })}
          </p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">
            {pickByLocale(locale, S.savedSearches.emptyList)}
          </p>
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
                    <p className="text-xs text-neutral-400">
                      {srcLabel} · {freqLabel} · {lastRunLabel} · {matchesLabel}
                    </p>
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-surface p-2 text-xxs text-neutral-500">
                      {JSON.stringify(item.queryJson, null, 0)}
                    </pre>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(item.id)}
                    className="rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:text-destructive"
                  >
                    {pickByLocale(locale, S.savedSearches.delete)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
