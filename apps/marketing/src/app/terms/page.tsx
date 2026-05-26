import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Terms of Service — Borjie',
  description: 'Borjie terms of service. Tanzania jurisdiction. Mining-domain specific (Tumemadini, NEMC, TRA, FIU).',
};

export default async function TermsPage() {
  const locale = await getLocale();
  const t = getMessages(locale).termsPage;

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
          <TermsBody locale={locale} />
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}

function TermsBody({ locale }: { readonly locale: 'sw' | 'en' }) {
  if (locale === 'sw') {
    return (
      <div className="space-y-6 text-sm leading-relaxed text-neutral-400">
        <Section title="1. Mkataba">
          Kwa kutumia Borjie unakubali masharti haya. Borjie ni Borjie Tanzania Limited, kampuni iliyosajiliwa Tanzania (BRELA registration: pending). Mkataba unaongozwa na sheria za Tanzania. Sehemu yenye mamlaka ni Mahakama Kuu ya Tanzania Dar es Salaam.
        </Section>
        <Section title="2. Tiers na malipo">
          Tiers tano: Mwanzo (bure), Mkulima (TZS 150,000/mwezi), Mfanyabiashara (TZS 500,000/mwezi), Kampuni (TZS 1,500,000/mwezi), Group (bespoke). Malipo kwa mwezi, mbele. Kushindwa kulipa kwa siku 14 kunazima kazi za autonomous (lakini huzima audit chain — historia yako inabaki yako milele).
        </Section>
        <Section title="3. Data yako ni yako">
          Wewe unamiliki data ya mgodi wako. Tunaweka tu kwa niaba yako. Ukifuta account, tutahamisha data yako (au kufuta) ndani ya siku 30. Audit chain inabaki immutable kwa mujibu wa sheria ya Tumemadini ya kuhifadhi rekodi.
        </Section>
        <Section title="4. Master Brain na uwajibikaji">
          Master Brain anatekeleza kazi kwa kibali chako. Hatuhakikishi maamuzi yake bila kosa, lakini tunahakikisha kuwa kila kitendo kimerekodiwa kwenye audit chain. Endapo Borjie itasababisha hasara ya moja kwa moja kwa kasoro ya programu, dhima yetu imepunguzwa kwa malipo ya miezi 12 ya mwisho.
        </Section>
        <Section title="5. Vitendo vilivyokatazwa">
          Hauwezi kutumia Borjie kuficha shughuli zilizo kinyume na sheria, kuepuka royalties za TRA, au kufanya money laundering. Ukianzisha shughuli yenye shaka, tutaiwajibisha mamlaka husika kwa mujibu wa sheria.
        </Section>
        <Section title="6. Kuvunja na kufungua tena">
          Wewe au sisi tunaweza kuvunja mkataba kwa notice ya siku 30. Tukivunja, tutakuhamisha data ndani ya siku 60. Tunaweza kufunga account haraka kwa ukiukaji mkubwa wa masharti haya.
        </Section>
        <Section title="7. Mawasiliano">
          Mabadiliko ya masharti: notice ya siku 30 kupitia cockpit yako. Kwa swali: legal@borjie.co.tz.
        </Section>
      </div>
    );
  }
  return (
    <div className="space-y-6 text-sm leading-relaxed text-neutral-400">
      <Section title="1. Agreement">
        By using Borjie you accept these terms. Borjie is Borjie Tanzania Limited, a Tanzania-registered company (BRELA registration: pending). The agreement is governed by Tanzanian law. Jurisdiction is the High Court of Tanzania, Dar es Salaam.
      </Section>
      <Section title="2. Tiers and billing">
        Five tiers: Mwanzo (free), Mkulima (TZS 150,000/mo), Mfanyabiashara (TZS 500,000/mo), Kampuni (TZS 1,500,000/mo), Group (bespoke). Billed monthly in advance. Non-payment for 14 days pauses autonomous actions (but never the audit chain — your history remains yours forever).
      </Section>
      <Section title="3. Your data is yours">
        You own your mining data. We hold it on your behalf. If you close the account we will export (or delete) your data within 30 days. The audit chain remains immutable per Tumemadini record-retention rules.
      </Section>
      <Section title="4. Master Brain and liability">
        The Master Brain executes actions on your authority. We do not warrant flawless decisions, but we warrant that every action is recorded on the audit chain. If Borjie directly causes losses through a software defect, our liability is capped at the trailing 12 months of fees.
      </Section>
      <Section title="5. Prohibited use">
        You may not use Borjie to conceal illegal activity, evade TRA royalties, or launder funds. If we detect suspicious activity we will report it to the relevant authority as required by law.
      </Section>
      <Section title="6. Termination">
        You or we may terminate with 30 days' notice. On termination we export your data within 60 days. We may suspend immediately for material breach.
      </Section>
      <Section title="7. Contact">
        Terms updates: 30-day in-cockpit notice. Questions: legal@borjie.co.tz.
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
