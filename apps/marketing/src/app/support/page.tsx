import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Mail,
  Phone,
  MessageCircle,
  BookOpen,
  Calendar,
  LifeBuoy,
  Activity,
} from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

/**
 * /support , LitFin-parity support hub.
 *
 * Per `Docs/DESIGN/LITFIN_MARKETING_SECONDARY_SPEC.md` section 4:
 *   - centered hero with search placeholder
 *   - 3-up quick-link cards (Help articles, Onboarding, Office hours)
 *   - FAQ accordion grouped into categories
 *   - 3-up contact strip (email, phone, WhatsApp)
 *   - final CTA band routing to office hours
 *
 * Bilingual sw / en, no em-dashes, time-aware copy where applicable.
 */

export const metadata: Metadata = {
  title: 'Support , Borjie',
  description:
    'Borjie support hub. FAQ, office hours, and direct channels for owners, buyers, and regulators.',
};

interface FaqItem {
  readonly en: { readonly q: string; readonly a: string };
  readonly sw: { readonly q: string; readonly a: string };
}

const FAQS: ReadonlyArray<{
  readonly id: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly items: ReadonlyArray<FaqItem>;
}> = [
  {
    id: 'getting-started',
    titleEn: 'Getting started',
    titleSw: 'Anza hapa',
    items: [
      {
        en: {
          q: 'How do I sign up for the pilot?',
          a: 'Apply at /pilot. The Borjie team reviews each application and ships an onboarding pack within 5 working days.',
        },
        sw: {
          q: 'Naomba majaribio vipi?',
          a: 'Tuma maombi kupitia /pilot. Timu ya Borjie inakagua kila maombi na kutuma kifurushi cha mafunzo ndani ya siku tano za kazi.',
        },
      },
      {
        en: {
          q: 'Is Borjie free during the pilot?',
          a: 'Yes. Pilot tenants pay nothing for the first 12 weeks. After that, the Mkulima tier starts at TZS 200,000 per month.',
        },
        sw: {
          q: 'Borjie ni bure wakati wa majaribio?',
          a: 'Ndio. Wadau wa majaribio hawalipi chochote kwa wiki kumi na mbili za kwanza. Baada ya hapo, kiwango cha Mkulima kinaanza TZS 200,000 kwa mwezi.',
        },
      },
    ],
  },
  {
    id: 'compliance',
    titleEn: 'Compliance and licences',
    titleSw: 'Kanuni na leseni',
    items: [
      {
        en: {
          q: 'Which regulators does Borjie automate filings for?',
          a: 'Tumemadini, NEMC, TRA, BoT, BRELA, OSHA, FIU, and NACTVET. Each filing carries an audit hash chain so the regulator can verify provenance.',
        },
        sw: {
          q: 'Borjie inaweka ripoti za kiotomatiki kwa wakaguzi gani?',
          a: 'Tumemadini, NEMC, TRA, BoT, BRELA, OSHA, FIU, na NACTVET. Kila ripoti ina mnyororo wa ukaguzi ili mkaguzi athibitishe usahihi.',
        },
      },
    ],
  },
  {
    id: 'money',
    titleEn: 'Treasury and payouts',
    titleSw: 'Hazina na malipo',
    items: [
      {
        en: {
          q: 'How does the BoT gold window settle?',
          a: 'Borjie posts every accepted parcel to the BoT settlement bus. USD is repatriated through your bank within 48 hours, with full reconciliation logged in the ledger.',
        },
        sw: {
          q: 'Dirisha la dhahabu la BoT linafanya kazi vipi?',
          a: 'Borjie inawasilisha kila kifurushi kilichokubaliwa kwenye basi la malipo la BoT. USD inarudishwa kupitia benki yako ndani ya saa 48 na rekodi kamili kwenye ledger.',
        },
      },
    ],
  },
];

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

const QUICK_LINKS: ReadonlyArray<{
  readonly href: string;
  readonly Icon: IconComponent;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly bodyEn: string;
  readonly bodySw: string;
}> = [
  {
    href: '/docs',
    Icon: BookOpen,
    titleEn: 'Help articles',
    titleSw: 'Makala ya msaada',
    bodyEn: 'Step-by-step guides for owners, supervisors, and buyers.',
    bodySw: 'Miongozo ya hatua kwa hatua kwa wamiliki, wasimamizi, na wanunuzi.',
  },
  {
    href: '/pilot',
    Icon: LifeBuoy,
    titleEn: 'Onboarding',
    titleSw: 'Mafunzo ya mwanzo',
    bodyEn: '12-week co-development pilot with a Borjie field engineer.',
    bodySw: 'Majaribio ya wiki 12 ya ushirikiano na mhandisi wa Borjie.',
  },
  {
    href: '/contact',
    Icon: Calendar,
    titleEn: 'Office hours',
    titleSw: 'Saa za ofisi',
    bodyEn: 'Live Q and A every Tuesday at 14:00 EAT.',
    bodySw: 'Maswali na majibu kila Jumanne saa 14:00 EAT.',
  },
];

export default async function SupportPage() {
  const locale = await getLocale();
  const isSw = locale === 'sw';

  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/40">
          <div className="hero-aurora" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-6 py-20 text-center lg:py-28">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {isSw ? 'Msaada' : 'Support'}
            </p>
            <h1 className="mt-5 font-display text-5xl font-medium tracking-tight text-balance sm:text-6xl">
              {isSw ? 'Tuko hapa kukusaidia.' : "We're here to help."}
            </h1>
            <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-neutral-400 sm:text-xl">
              {isSw
                ? 'Pata majibu, fungua tikiti, au panga saa za ofisi.'
                : 'Find answers, open a ticket, or book office hours.'}
            </p>
            <div className="mx-auto mt-8 flex max-w-md items-center gap-2 rounded-full border border-border bg-card px-4 py-2">
              <input
                type="search"
                disabled
                placeholder={
                  isSw
                    ? 'Tafuta msaada (inakuja)'
                    : 'Search help articles (coming soon)'
                }
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-neutral-500 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Quick-link cards 3-up */}
        <section className="mx-auto max-w-5xl px-6 py-16 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {QUICK_LINKS.map((link) => {
              const Icon = link.Icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="group rounded-2xl border border-border bg-card p-6 transition-colors hover:border-signal-500"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-signal-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-medium text-foreground">
                    {isSw ? link.titleSw : link.titleEn}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-400">
                    {isSw ? link.bodySw : link.bodyEn}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-signal-500">
                    {isSw ? 'Endelea' : 'Open'}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* FAQ */}
        <section
          className="border-t border-border bg-surface/40 px-5 py-16 md:py-20"
          aria-labelledby="support-faq"
        >
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              FAQ
            </p>
            <h2
              id="support-faq"
              className="mt-3 font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl"
            >
              {isSw ? 'Maswali ya mara kwa mara' : 'Frequently asked questions'}
            </h2>
            <div className="mt-10 space-y-8">
              {FAQS.map((group) => (
                <div key={group.id}>
                  <h3 className="font-display text-lg font-medium text-foreground">
                    {isSw ? group.titleSw : group.titleEn}
                  </h3>
                  <div className="mt-3 space-y-2">
                    {group.items.map((item, i) => {
                      const copy = isSw ? item.sw : item.en;
                      return (
                        <details
                          key={i}
                          className="group rounded-xl border border-border bg-card px-4 py-3"
                        >
                          <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">
                            {copy.q}
                          </summary>
                          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                            {copy.a}
                          </p>
                        </details>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact strip */}
        <section className="border-t border-border px-5 py-16 md:py-20">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 sm:grid-cols-3">
            <ContactCard
              Icon={Mail}
              title={isSw ? 'Email' : 'Email'}
              value="support@borjie.co.tz"
              href="mailto:support@borjie.co.tz"
            />
            <ContactCard
              Icon={Phone}
              title={isSw ? 'Simu' : 'Phone'}
              value="+255 22 211 4000"
              href="tel:+255222114000"
            />
            <ContactCard
              Icon={MessageCircle}
              title="WhatsApp"
              value="+255 754 200 200"
              href="https://wa.me/255754200200"
            />
          </div>
        </section>

        {/* Status + final CTA */}
        <section className="border-t border-border bg-surface/40 px-5 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              {isSw ? 'Panga saa za ofisi.' : 'Schedule office hours.'}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-neutral-400">
              {isSw
                ? 'Saa moja na timu yetu kupanga matumizi yako.'
                : 'One hour with our team to plan your rollout.'}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                {isSw ? 'Wasiliana nasi' : 'Get in touch'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/status"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border bg-card px-6 text-sm font-semibold text-foreground transition-colors hover:bg-surface-raised"
              >
                <Activity className="h-4 w-4" aria-hidden="true" />
                {isSw ? 'Hali ya mfumo' : 'System status'}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer locale={locale} />
    </>
  );
}

function ContactCard({
  Icon,
  title,
  value,
  href,
}: {
  readonly Icon: IconComponent;
  readonly title: string;
  readonly value: string;
  readonly href: string;
}) {
  return (
    <a
      href={href}
      className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-signal-500"
    >
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-signal-500">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 font-mono text-xs uppercase tracking-widest text-neutral-400">
        {title}
      </p>
      <p className="mt-1 font-display text-lg font-medium text-foreground">
        {value}
      </p>
    </a>
  );
}
