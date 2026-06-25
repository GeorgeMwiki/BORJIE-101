'use client';

/**
 * Client panel for the personal-KB list page.
 *
 * - GET /api/v1/me/persons/links → list person_links
 * - GET /api/v1/brain/personal-kb/search → full-text cell search
 *
 * Bilingual sw/en labels throughout. Search results render under the
 * "hats" list when a query is present; an empty query restores the
 * default list view.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton, Input } from '@borjie/design-system';
import { apiRequest, localizeError } from '@/lib/api-client';
import { routesAStrings as S } from '@/i18n/strings/routes-a';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';

interface PersonLink {
  readonly id: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly roleInTenant: string;
  readonly linkedAt: string;
  readonly unlinkedAt: string | null;
  readonly displayName: string;
  readonly preferredLanguage: string;
  readonly consentGranted: boolean;
}

interface MemoryCell {
  readonly id: string;
  readonly personId: string;
  readonly cellKind: string;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: string;
  readonly sourceTenantId: string | null;
  readonly capturedAt: string;
}

function roleLabel(locale: Locale, role: string): string {
  const map: Record<string, { readonly en: string; readonly sw: string }> = {
    owner: S.personalKbPanel.roleOwner,
    manager: S.personalKbPanel.roleManager,
    employee: S.personalKbPanel.roleEmployee,
    buyer: S.personalKbPanel.roleBuyer,
    admin: S.personalKbPanel.roleAdmin,
  };
  const entry = map[role];
  return entry ? pickByLocale(locale, entry) : role;
}

export function PersonalKbPanel({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}) {
  const locale = useLocale(initialLocale);
  const [links, setLinks] = useState<ReadonlyArray<PersonLink>>([]);
  const [loadingLinks, setLoadingLinks] = useState<boolean>(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<ReadonlyArray<MemoryCell>>([]);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLinks = async () => {
      setLoadingLinks(true);
      setLinkError(null);
      try {
        // apiRequest prepends the gateway base, attaches the Supabase Bearer,
        // and unwraps the {success,data} envelope — so this is the links array.
        const data = await apiRequest<ReadonlyArray<PersonLink>>(
          '/api/v1/me/persons/links',
          { method: 'GET' },
        );
        if (!cancelled) setLinks(data ?? []);
      } catch (err) {
        if (!cancelled) {
          // Localise from the gateway CODE — raw `err.message` leaks English
          // into the `sw` error row.
          setLinkError(localizeError(err, locale));
        }
      } finally {
        if (!cancelled) setLoadingLinks(false);
      }
    };
    void fetchLinks();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      // apiRequest prepends the gateway base, attaches the Supabase Bearer,
      // and unwraps the {success,data} envelope — so this is the cells array.
      const data = await apiRequest<ReadonlyArray<MemoryCell>>(
        `/api/v1/brain/personal-kb/search?q=${encodeURIComponent(query)}&limit=20`,
        { method: 'GET' },
      );
      setSearchResults(data ?? []);
    } catch (err) {
      setSearchError(localizeError(err, locale));
    } finally {
      setSearching(false);
    }
  }, [query, locale]);

  return (
    <section className="mt-6 space-y-6">
      <form
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, S.personalKbPanel.searchHeading)}
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.personalKbPanel.searchGloss)}
        </p>
        <div className="flex gap-2">
          <Input
            type="search"
            className="flex-1"
            placeholder={pickByLocale(locale, S.personalKbPanel.searchPlaceholder)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          <Button
            type="submit"
            disabled={!query.trim()}
            loading={searching}
          >
            {pickByLocale(locale, S.personalKbPanel.searchButton)}
          </Button>
        </div>
        {searchError ? (
          <p className="text-sm text-destructive">
            {pickByLocale(locale, S.personalKbPanel.errorPrefix)}
            {searchError}
          </p>
        ) : null}
      </form>

      {query.trim() ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-display text-xl text-foreground">
            {pickByLocale(locale, S.personalKbPanel.resultsHeading)} (
            {searchResults.length})
          </h2>
          <p className="text-xs italic text-muted-foreground">
            {pickByLocale(locale, S.personalKbPanel.resultsGloss)}
          </p>
          {searchResults.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {pickByLocale(locale, S.personalKbPanel.noMatches)}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {searchResults.map((cell) => (
                <MemoryCellRow key={cell.id} cell={cell} locale={locale} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-foreground">
          {pickByLocale(locale, S.personalKbPanel.hatsHeading)} ({links.length})
        </h2>
        <p className="text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.personalKbPanel.hatsGloss)}
        </p>
        {loadingLinks ? (
          <div
            className="mt-4 space-y-2"
            role="status"
            aria-label={pickByLocale(locale, S.personalKbPanel.loading)}
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded border border-border" />
            ))}
          </div>
        ) : linkError ? (
          <p className="mt-4 text-sm text-destructive">
            {pickByLocale(locale, S.personalKbPanel.errorPrefix)}
            {linkError}
          </p>
        ) : links.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {pickByLocale(locale, S.personalKbPanel.noHats)}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {links.map((link) => (
              <li
                key={link.id}
                className="rounded border border-border bg-background p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {link.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabel(locale, link.roleInTenant)}
                      {' · '}
                      {pickByLocale(locale, S.personalKbPanel.tenantWord)}{' '}
                      {link.tenantId.slice(0, 8)}…
                      {' · '}
                      {pickByLocale(locale, S.personalKbPanel.linkedWord)}{' '}
                      {new Date(link.linkedAt).toLocaleDateString(
                        bcp47For(locale),
                      )}
                    </p>
                    {!link.consentGranted ? (
                      <p className="mt-1 text-xs text-warning">
                        {pickByLocale(locale, S.personalKbPanel.consentPending)}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`/personal-kb/${link.personId}`}
                    className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {pickByLocale(locale, S.personalKbPanel.openButton)}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MemoryCellRow({
  cell,
  locale,
}: {
  readonly cell: MemoryCell;
  readonly locale: Locale;
}) {
  const valueText =
    typeof cell.value === 'string'
      ? cell.value
      : JSON.stringify(cell.value);
  return (
    <li className="rounded border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground">{cell.key}</p>
        <span className="rounded-full border border-border px-2 py-0.5 text-xxs text-muted-foreground">
          {cell.cellKind}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{valueText}</p>
      <p className="mt-1 text-xxs text-muted-foreground">
        {pickByLocale(locale, S.personalKbPanel.captured)}{' '}
        {new Date(cell.capturedAt).toLocaleString(bcp47For(locale))} ·{' '}
        {pickByLocale(locale, S.personalKbPanel.confidence)} {cell.confidence}
      </p>
    </li>
  );
}
