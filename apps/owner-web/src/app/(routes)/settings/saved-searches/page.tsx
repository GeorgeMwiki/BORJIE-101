/**
 * Saved searches settings page — Roadmap R2.
 *
 * Owner-defined alert rules. Each rule is one (label, queryJson,
 * frequency, source) tuple; the worker re-runs the query on the
 * frequency cadence and dispatches an owner-messaging alert when
 * new matches land.
 *
 * Server component renders the heading + Swahili gloss; the client
 * component drives the form + list against
 * /api/v1/owner/saved-searches.
 */

import { SavedSearchesPanel } from './saved-searches-panel';

export const dynamic = 'force-dynamic';

export default function SavedSearchesPage() {
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          Saved searches
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Utafutaji uliohifadhiwa — pata arifa zinapokuja
        </p>
        <p className="mt-3 max-w-2xl text-sm text-neutral-300">
          Create alert rules: the worker re-runs each search on its
          chosen cadence and notifies you the moment new matches arrive.
        </p>
      </header>
      <SavedSearchesPanel />
    </main>
  );
}
