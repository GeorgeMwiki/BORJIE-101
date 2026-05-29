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

const ROLE_LABELS_SW: Record<string, string> = {
  owner: 'Mmiliki',
  manager: 'Meneja',
  employee: 'Mfanyakazi',
  buyer: 'Mnunuzi',
  admin: 'Msimamizi',
};

export function PersonalKbPanel() {
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
        const res = await fetch('/api/v1/me/persons/links', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          success: boolean;
          data?: ReadonlyArray<PersonLink>;
        };
        if (!cancelled) setLinks(json.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setLinkError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoadingLinks(false);
      }
    };
    void fetchLinks();
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/v1/brain/personal-kb/search?q=${encodeURIComponent(query)}&limit=20`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        data?: ReadonlyArray<MemoryCell>;
      };
      setSearchResults(json.data ?? []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [query]);

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
          Search my knowledge base
        </h2>
        <p className="text-xs italic text-neutral-500">
          Tafuta kwenye maktaba yangu
        </p>
        <div className="flex gap-2">
          <input
            type="search"
            className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder="e.g. mother / mama / payroll deadline"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40"
          >
            {searching ? 'Searching…' : 'Search / Tafuta'}
          </button>
        </div>
        {searchError ? (
          <p className="text-sm text-destructive">Error: {searchError}</p>
        ) : null}
      </form>

      {query.trim() ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-display text-xl text-foreground">
            Search results ({searchResults.length})
          </h2>
          <p className="text-xs italic text-neutral-500">Matokeo ya utafutaji</p>
          {searchResults.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-400">
              No matches yet. / Hakuna matokeo bado.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {searchResults.map((cell) => (
                <MemoryCellRow key={cell.id} cell={cell} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="font-display text-xl text-foreground">
          Your hats ({links.length})
        </h2>
        <p className="text-xs italic text-neutral-500">
          Kofia zako — mahali pote unapotumia Borjie
        </p>
        {loadingLinks ? (
          <p className="mt-4 text-sm text-neutral-400">Loading…</p>
        ) : linkError ? (
          <p className="mt-4 text-sm text-destructive">Error: {linkError}</p>
        ) : links.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">
            No hats yet. / Hauna kofia bado.
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
                    <p className="text-xs text-neutral-400">
                      {(ROLE_LABELS_SW[link.roleInTenant] ?? link.roleInTenant)}
                      {' · '}
                      tenant {link.tenantId.slice(0, 8)}…
                      {' · '}
                      linked {new Date(link.linkedAt).toLocaleDateString()}
                    </p>
                    {!link.consentGranted ? (
                      <p className="mt-1 text-xs text-amber-400">
                        Consent not granted yet — open this hat to grant
                        unified-KB consent.
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`/personal-kb/${link.personId}`}
                    className="rounded border border-border px-3 py-1 text-xs text-neutral-200 hover:text-foreground"
                  >
                    Open / Fungua
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

function MemoryCellRow({ cell }: { readonly cell: MemoryCell }) {
  const valueText =
    typeof cell.value === 'string'
      ? cell.value
      : JSON.stringify(cell.value);
  return (
    <li className="rounded border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground">{cell.key}</p>
        <span className="rounded-full border border-border px-2 py-0.5 text-xxs text-neutral-400">
          {cell.cellKind}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-300">{valueText}</p>
      <p className="mt-1 text-xxs text-neutral-500">
        captured {new Date(cell.capturedAt).toLocaleString()} · confidence{' '}
        {cell.confidence}
      </p>
    </li>
  );
}
