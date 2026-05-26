import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { PilotForm } from '@/components/PilotForm';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Apply for the Borjie pilot — Borjie',
  description:
    'Apply to join the Borjie pilot programme. 20 selected Tanzanian mining operators. No cost. 12 weeks of co-development.',
};

export default async function PilotPage() {
  const locale = await getLocale();
  const t = getMessages(locale).pilotPage;

  return (
    <>
      <Nav locale={locale} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {t.kicker}
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          {t.heading}
        </h1>
        <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-neutral-400">
          {t.sub}
        </p>

        <div className="mt-12 rounded-2xl border border-border bg-surface p-8 sm:p-10">
          <PilotForm locale={locale} />
        </div>

        <p className="mt-8 text-sm text-neutral-400">
          {locale === 'sw'
            ? 'Maswali? Tuma email kwa pilot@borjie.co.tz au piga +255 22 211 4000.'
            : 'Questions? Email pilot@borjie.co.tz or call +255 22 211 4000.'}
        </p>
      </main>
      <Footer locale={locale} />
    </>
  );
}
