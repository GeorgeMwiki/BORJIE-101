/**
 * Personal-KB list page — Roadmap R8.
 *
 * Lists every "hat" the human wears (person_links rows joined with
 * the canonical persons row) plus a search bar that hits
 * /api/v1/brain/personal-kb/search. Tap a link → /personal-kb/[id]
 * detail page showing recent memory cells.
 *
 * Server component renders the heading; the client component drives
 * the list + search.
 */

import { PersonalKbPanel } from './personal-kb-panel';

export const dynamic = 'force-dynamic';

export default function PersonalKbPage() {
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          Personal knowledge base
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Maktaba yangu — vitu vyote nilivyokuelezea kuhusu mimi
        </p>
        <p className="mt-3 max-w-2xl text-sm text-neutral-300">
          Every preference, recurring fact, and context you have shared
          with Borjie. Crosses tenant boundaries — your assistant
          remembers you, not the company you happen to be working with.
        </p>
      </header>
      <PersonalKbPanel />
    </main>
  );
}
