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

import { apiRequest, localizeError } from '@/lib/api-client';
import {
  savedSearchesStrings as S,
  savedSearchLastRun,
  savedSearchMatches,
} from '@/i18n/strings/saved-searches-page';
import { fmtNum, fmtDateForLocale } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
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

const FREQUENCY_LABELS: Record<
  SavedSearch['frequency'],
  { readonly en: string; readonly sw: string }
> = {
  hourly: S.frequencyHourly,
  daily: S.frequencyDaily,
  weekly: S.frequencyWeekly,
};

const SOURCE_LABELS: Record<
  SavedSearch['source'],
  { readonly en: string; readonly sw: string }
> = {
  marketplace: S.sourceMarketplace,
  opportunities: S.sourceOpportunities,
  regulatory: S.sourceRegulatory,
};

export function SavedSearchesPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
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
      // Localise from the gateway error CODE — raw `err.message` would leak
      // English into the `sw` <Alert>.
      setError(localizeError(err, locale));
    } finally {
      setLoading(false);
    }
  }, [locale]);

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
      setError(pickByLocale(locale, S.invalidQueryJson));
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
      setError(localizeError(err, locale));
    } finally {
      setCreating(false);
    }
  }, [label, queryText, frequency, source, refresh, locale]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiRequest(`/api/v1/owner/saved-searches/${id}`, {
          method: 'DELETE',
        });
        await refresh();
      } catch (err) {
        setError(localizeError(err, locale));
      }
    },
    [refresh, locale],
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
          {pickByLocale(locale, S.newSearchHeading)}
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.newSearchTagline)}
        </p>
        <FormField label={pickByLocale(locale, S.labelField)}>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            maxLength={120}
            placeholder={pickByLocale(locale, S.labelPlaceholder)}
          />
        </FormField>
        <FormField label={pickByLocale(locale, S.queryField)}>
          <Textarea
            className="h-24 font-mono text-xs"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={pickByLocale(locale, S.queryPlaceholder)}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={pickByLocale(locale, S.frequencyField)}>
            <Select
              value={frequency}
              onValueChange={(v) => setFrequency(v as SavedSearch['frequency'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">
                  {pickByLocale(locale, S.frequencyHourly)}
                </SelectItem>
                <SelectItem value="daily">
                  {pickByLocale(locale, S.frequencyDaily)}
                </SelectItem>
                <SelectItem value="weekly">
                  {pickByLocale(locale, S.frequencyWeekly)}
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={pickByLocale(locale, S.sourceField)}>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as SavedSearch['source'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="marketplace">
                  {pickByLocale(locale, S.sourceMarketplace)}
                </SelectItem>
                <SelectItem value="opportunities">
                  {pickByLocale(locale, S.sourceOpportunities)}
                </SelectItem>
                <SelectItem value="regulatory">
                  {pickByLocale(locale, S.sourceRegulatory)}
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
            ? pickByLocale(locale, S.saving)
            : pickByLocale(locale, S.save)}
        </Button>
        {error ? (
          <p className="text-sm text-destructive">
            {pickByLocale(locale, S.errorPrefix)}
            {error}
          </p>
        ) : null}
      </form>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, S.savedListHeading)}
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.savedListTagline)}
        </p>
        {loading ? (
          <div
            className="mt-4 space-y-2"
            role="status"
            aria-label={pickByLocale(locale, S.loading)}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg border border-border" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4">
            <ScreenEmptyState
              title={pickByLocale(locale, S.savedListHeading)}
              description={pickByLocale(locale, S.emptyList)}
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((item) => {
              const freqLabel = pickByLocale(locale, FREQUENCY_LABELS[item.frequency]);
              const srcLabel = pickByLocale(locale, SOURCE_LABELS[item.source]);
              const lastRunLabel = item.lastRunAt
                ? pickByLocale(
                    locale,
                    savedSearchLastRun(fmtDateForLocale(item.lastRunAt, locale)),
                  )
                : pickByLocale(locale, S.notYetRun);
              const matchesLabel = pickByLocale(
                locale,
                savedSearchMatches(fmtNum(item.lastMatchCount)),
              );
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
                    {pickByLocale(locale, S.delete)}
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
