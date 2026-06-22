/**
 * Personal-KB list page — Roadmap R8.
 *
 * Lists every "hat" the human wears (person_links rows joined with
 * the canonical persons row) plus a search bar that hits
 * /api/v1/brain/personal-kb/search. Tap a link → /personal-kb/[id]
 * detail page showing recent memory cells.
 *
 * Server component renders the heading; the client component drives
 * the list + search. The locale resolves ONCE on the server so the
 * heading + the seeded client panel render the same language (no
 * EN-under-SW split-brain).
 */

import { PersonalKbPanel } from './personal-kb-panel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { personalKbPageStrings as S } from '@/i18n/strings/personal-kb-page';

export const dynamic = 'force-dynamic';

export default async function PersonalKbPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          {pickByLocale(locale, S.title)}
        </h1>
        <p className="mt-0.5 text-xs italic text-muted-foreground">
          {pickByLocale(locale, S.subtitle)}
        </p>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {pickByLocale(locale, S.body)}
        </p>
      </header>
      <PersonalKbPanel initialLocale={locale} />
    </main>
  );
}
