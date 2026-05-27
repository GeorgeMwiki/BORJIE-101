import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Privacy Policy — Borjie',
  description: 'Borjie privacy policy. Tanzania Personal Data Protection Act 2022. Per-tenant audit chain, scope-separated data.',
};

export default async function PrivacyPage() {
  const locale = await getLocale();
  const t = getMessages(locale).privacyPage;

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
        <p className="mt-2 font-mono text-pill uppercase tracking-widest text-neutral-400">
          {t.lastUpdated}
        </p>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-neutral-400">
          {t.sections.map((s) => (
            <Section key={s.title} title={s.title}>
              {s.body}
            </Section>
          ))}
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg font-medium tracking-tight text-foreground">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}
