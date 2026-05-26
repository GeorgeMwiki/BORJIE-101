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
        <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-widest text-neutral-400">
          {t.lastUpdated}
        </p>

        <div className="mt-10">
          <PolicyBody locale={locale} />
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}

function PolicyBody({ locale }: { readonly locale: 'sw' | 'en' }) {
  if (locale === 'sw') {
    return (
      <div className="space-y-6 text-sm leading-relaxed text-neutral-400">
        <Section title="1. Tunakusanya nini">
          Borjie inakusanya data ya biashara yako ya mgodi — leseni za PML/ML/SML, ramani za pit, drill-hole logs, shughuli za off-take, royalty returns, na ujumbe wa watumiaji wako. Hatukusanyi data za kibinafsi za wachimbaji binafsi isipokuwa ikiwa wameipakia wenyewe au mmiliki ametuagiza.
        </Section>
        <Section title="2. Kwa nini">
          Tunatumia data hii kuendesha Master Brain yako, kutoa briefing za asubuhi, kuandaa reports kwa Tumemadini na TRA, na kufanya hedge proposals kwenye gold-window. Hatuiuzi kwa watu wengine. Hatuitumii kwa matangazo.
        </Section>
        <Section title="3. Wapi inaishi">
          Data yako iko kwenye database iliyo Tanzania (Dar es Salaam region kwenye Fly.io fra1 kama backup). Audit chain ipo per-tenant — tenant yako haiwezi kusoma chain ya tenant mwingine, hata kama wewe ni admin.
        </Section>
        <Section title="4. Haki zako">
          Kwa mujibu wa Tanzania Personal Data Protection Act 2022, una haki ya kuangalia data yako, kurekebisha, kufuta, na kuhamisha kwa muuzaji mwingine. Tuma email kwa privacy@borjie.co.tz.
        </Section>
        <Section title="5. Tumemadini na NEMC">
          Endapo mamlaka ya Tanzania (Tumemadini, NEMC, TRA, FIU) inahitaji data yako kwa mujibu wa sheria, tutawapa lakini tutakuarifu ndani ya siku 5 isipokuwa amri inayotaka tunyamaze imewekwa na korti.
        </Section>
        <Section title="6. Mawasiliano">
          Sera hii inakuwa updated mara kwa mara. Mabadiliko makubwa tutakutumia notification ndani ya cockpit yako siku 30 kabla ya kuanza kutumika. Kwa swali lolote: privacy@borjie.co.tz.
        </Section>
      </div>
    );
  }
  return (
    <div className="space-y-6 text-sm leading-relaxed text-neutral-400">
      <Section title="1. What we collect">
        Borjie collects your mining business data — PML/ML/SML licences, pit maps, drill-hole logs, off-take transactions, royalty returns, and your users' messages. We do not collect personal data on individual artisanal miners unless they upload it themselves or an owner directs us to.
      </Section>
      <Section title="2. Why">
        We use this data to run your Master Brain, deliver morning briefings, prepare reports for Tumemadini and TRA, and propose gold-window hedges. We do not sell it. We do not use it for advertising.
      </Section>
      <Section title="3. Where it lives">
        Your data is stored in a Tanzania-resident database (Dar es Salaam region, with Fly.io fra1 as DR backup). Audit chains are per-tenant — your tenant cannot read another tenant's chain even if you are an admin.
      </Section>
      <Section title="4. Your rights">
        Under the Tanzania Personal Data Protection Act 2022 you have the right to view, correct, delete, and port your data to another vendor. Email privacy@borjie.co.tz.
      </Section>
      <Section title="5. Tumemadini and NEMC">
        If a Tanzanian authority (Tumemadini, NEMC, TRA, FIU) lawfully demands your data we will provide it, but we will notify you within 5 days unless a gag order is in place.
      </Section>
      <Section title="6. Contact">
        This policy is updated periodically. Material changes get a 30-day in-cockpit notice before they take effect. Questions: privacy@borjie.co.tz.
      </Section>
    </div>
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
