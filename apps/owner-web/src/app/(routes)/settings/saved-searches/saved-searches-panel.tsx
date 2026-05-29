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

const FREQUENCY_LABELS_SW: Record<SavedSearch['frequency'], string> = {
  hourly: 'Kila saa',
  daily: 'Kila siku',
  weekly: 'Kila wiki',
};

const SOURCE_LABELS_SW: Record<SavedSearch['source'], string> = {
  marketplace: 'Soko',
  opportunities: 'Fursa',
  regulatory: 'Kanuni',
};

export function SavedSearchesPanel() {
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
        headers: { 'Content-Type': 'application/json' },
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
          New saved search
        </h2>
        <p className="text-xs italic text-neutral-500">
          Utafutaji mpya — toa jina, andika maswali yako, chagua mzunguko
        </p>
        <label className="block text-sm">
          <span className="text-neutral-300">Label / Jina</span>
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
          <span className="text-neutral-300">Query JSON / Maswali (JSON)</span>
          <textarea
            className="mt-1 h-24 w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder='{"commodity":"gold","minPurity":22,"region":"geita"}'
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-neutral-300">Frequency / Mzunguko</span>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as SavedSearch['frequency'])
              }
            >
              <option value="hourly">Hourly / Kila saa</option>
              <option value="daily">Daily / Kila siku</option>
              <option value="weekly">Weekly / Kila wiki</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-neutral-300">Source / Chanzo</span>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as SavedSearch['source'])
              }
            >
              <option value="marketplace">Marketplace / Soko</option>
              <option value="opportunities">Opportunities / Fursa</option>
              <option value="regulatory">Regulatory / Kanuni</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={creating || !label.trim()}
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
        >
          {creating ? 'Saving…' : 'Save / Hifadhi'}
        </button>
        {error ? (
          <p className="text-sm text-destructive">Error: {error}</p>
        ) : null}
      </form>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-foreground">
          Your saved searches
        </h2>
        <p className="text-xs italic text-neutral-500">
          Utafutaji wako uliohifadhiwa
        </p>
        {loading ? (
          <p className="mt-4 text-sm text-neutral-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">
            No saved searches yet. / Hakuna utafutaji uliohifadhiwa.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 rounded border border-border bg-background p-3"
              >
                <div>
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-neutral-400">
                    {SOURCE_LABELS_SW[item.source]} ·{' '}
                    {FREQUENCY_LABELS_SW[item.frequency]}
                    {item.lastRunAt
                      ? ` · last ${new Date(item.lastRunAt).toLocaleString()}`
                      : ' · not yet run'}
                    {' · '}
                    {item.lastMatchCount} matches
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
                  Delete / Futa
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
