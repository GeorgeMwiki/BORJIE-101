/**
 * /ask — Talk to the industry.
 *
 * The Borjie HQ cross-tenant conversation surface. Observer voice.
 * Every assistant claim grounds in differentially-private platform
 * aggregates — no single tenant is ever named.
 *
 * Layout: 3-column on ≥lg: industry-conversation list / canvas /
 * privacy-budget + artifact pane.
 */

import { ThreadList } from '@/components/ask/ThreadList';
import { AskChat } from '@/components/ask/AskChat';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

export const metadata = {
  title: 'Talk to the industry · Borjie HQ',
};

export default async function IndustryAskLandingPage() {
  // Seed the chat's first paint from the server-resolved `borjie_locale`
  // cookie so SSR + the first client render agree with the `<html lang>`
  // the root layout stamped (zero-mix canon — no EN-under-SW frame). The
  // page's own header chrome resolves through the SAME locale so the whole
  // surface speaks one language.
  const locale = await readLocaleFromServerCookies();
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-thread-narrow shrink-0 border-r border-border bg-surface-sunken lg:block">
        <ThreadList />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-8 py-6">
          <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {pickByLocale(locale, {
              en: 'Central intelligence · platform scope',
              sw: 'Akili kuu · upeo wa jukwaa',
            })}
          </p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight">
            {pickByLocale(locale, {
              en: 'Talk to the industry',
              sw: 'Zungumza na sekta',
            })}
          </h1>
          <p className="mt-2 max-w-prose-md text-sm leading-relaxed text-muted-foreground">
            {pickByLocale(locale, {
              en:
                'Across the network. Every claim is grounded in ' +
                'differentially-private aggregates. No single tenant is ever ' +
                'named. Every query costs privacy budget — the network ' +
                'remembers.',
              sw:
                'Katika mtandao mzima. Kila dai limeegemezwa kwenye ' +
                'majumuisho yenye faragha-tofautishi. Hakuna mteja mmoja ' +
                'anayetajwa kamwe. Kila ombi hugharimu bajeti ya faragha — ' +
                'mtandao hukumbuka.',
            })}
          </p>
        </header>

        <div className="flex-1 overflow-hidden">
          <AskChat
            threadId={null}
            initialMessages={[]}
            initialArtifacts={[]}
            initialLocale={locale}
          />
        </div>
      </main>

      <aside className="hidden w-thread-medium shrink-0 flex-col gap-4 border-l border-border bg-surface px-5 py-5 lg:flex">
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-caption uppercase tracking-widest text-muted-foreground">
            {pickByLocale(locale, {
              en: 'Observer note',
              sw: 'Dokezo la mtazamaji',
            })}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {pickByLocale(locale, {
              en:
                'I speak in the first-person plural for the industry. I ' +
                'never refer to any single tenant. If a pattern only one ' +
                'tenant shows, I refuse the query under k-anonymity.',
              sw:
                'Ninazungumza kwa nafsi ya kwanza wingi kwa niaba ya sekta. ' +
                'Sitaji kamwe mteja yeyote mmoja. Iwapo mchoro unaonyeshwa ' +
                'na mteja mmoja tu, ninakataa ombi chini ya k-anonymity.',
            })}
          </p>
        </div>
      </aside>
    </div>
  );
}
