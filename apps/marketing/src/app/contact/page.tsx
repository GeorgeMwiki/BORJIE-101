import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, Phone, MapPin, ArrowRight, MessageCircle } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

/**
 * /contact , LitFin-parity contact surface.
 *
 * Per `Docs/DESIGN/LITFIN_MARKETING_SECONDARY_SPEC.md` section 10:
 *   - centered hero (kicker, heading, sub)
 *   - inquiry-type chip strip (5 chips above the form)
 *   - 2-column band: form on the left, alternate channels + Tanzania
 *     office address + map placeholder on the right
 *   - final CTA: schedule a 15-minute call
 */

export const metadata: Metadata = {
  title: 'Contact , Borjie',
  description:
    'Talk to the Borjie team. Demo requests, partnerships, support, press. Tanzania office address.',
};

const INQUIRY_CHIPS: ReadonlyArray<{
  readonly id: string;
  readonly en: string;
  readonly sw: string;
}> = [
  { id: 'demo', en: 'Demo', sw: 'Onyesho' },
  { id: 'partnership', en: 'Partnership', sw: 'Ushirikiano' },
  { id: 'support', en: 'Support', sw: 'Msaada' },
  { id: 'general', en: 'General', sw: 'Jumla' },
  { id: 'press', en: 'Press', sw: 'Habari' },
];

export default async function ContactPage() {
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
              {isSw ? 'Wasiliana nasi' : 'Get in touch'}
            </p>
            <h1 className="mt-5 font-display text-5xl font-medium tracking-tight text-balance sm:text-6xl">
              {isSw
                ? 'Hebu tuzungumze kuhusu mgodi wako.'
                : "Let's talk about your operation."}
            </h1>
            <p className="mx-auto mt-6 max-w-prose-widest text-lg leading-relaxed text-neutral-400 sm:text-xl">
              {isSw
                ? 'Tunajibu ndani ya siku moja ya kazi.'
                : 'We respond within one working day.'}
            </p>
          </div>
        </section>

        {/* Inquiry chips */}
        <section className="mx-auto max-w-3xl px-6 py-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {INQUIRY_CHIPS.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground"
              >
                {isSw ? chip.sw : chip.en}
              </span>
            ))}
          </div>
        </section>

        {/* Form + alternates */}
        <section className="mx-auto max-w-6xl px-6 pb-16 lg:px-8 lg:pb-24">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
            <form
              action="/api/contact"
              method="post"
              className="rounded-2xl border border-border bg-card p-8"
            >
              <h2 className="font-display text-xl font-medium text-foreground">
                {isSw ? 'Tuandikie' : 'Send us a note'}
              </h2>
              <div className="mt-6 space-y-4">
                <Field
                  id="contact-name"
                  name="name"
                  label={isSw ? 'Jina' : 'Name'}
                  type="text"
                  required
                />
                <Field
                  id="contact-email"
                  name="email"
                  label="Email"
                  type="email"
                  required
                />
                <Field
                  id="contact-org"
                  name="org"
                  label={isSw ? 'Kampuni' : 'Organisation'}
                  type="text"
                />
                <label className="block text-sm">
                  <span className="block text-tiny font-medium text-foreground/80">
                    {isSw ? 'Aina ya swali' : 'Inquiry type'}
                  </span>
                  <select
                    name="kind"
                    className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                  >
                    {INQUIRY_CHIPS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isSw ? c.sw : c.en}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="block text-tiny font-medium text-foreground/80">
                    {isSw ? 'Ujumbe' : 'Message'}
                  </span>
                  <textarea
                    name="message"
                    rows={5}
                    required
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                {isSw ? 'Tuma ujumbe' : 'Send message'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>

            <div className="space-y-5">
              <ChannelCard
                Icon={Mail}
                title={isSw ? 'Barua pepe' : 'Email'}
                value="hello@borjie.co.tz"
                href="mailto:hello@borjie.co.tz"
              />
              <ChannelCard
                Icon={Phone}
                title={isSw ? 'Simu' : 'Phone'}
                value="+255 22 211 4000"
                href="tel:+255222114000"
              />
              <ChannelCard
                Icon={MessageCircle}
                title="WhatsApp"
                value="+255 754 200 200"
                href="https://wa.me/255754200200"
              />
              <div className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-start gap-3">
                  <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-signal-500">
                    <MapPin className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">
                      {isSw ? 'Ofisi ya Tanzania' : 'Tanzania office'}
                    </p>
                    <p className="mt-1 font-display text-base font-medium text-foreground">
                      Borjie Ltd
                    </p>
                    <p className="mt-1 text-sm text-neutral-400">
                      Plot 123, Bagamoyo Road
                      <br />
                      Dar es Salaam, Tanzania
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-border bg-surface/40 px-5 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              {isSw
                ? 'Au panga simu ya dakika 15.'
                : 'Or schedule a 15-minute call.'}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-neutral-400">
              {isSw
                ? 'Tutapitia mahitaji yako, kuonyesha mfano, na kushauri.'
                : "We'll walk your requirements, show a demo, and advise."}
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
            >
              {isSw ? 'Anza sasa' : 'Get started'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
      <Footer locale={locale} />
    </>
  );
}

function Field({
  id,
  name,
  label,
  type,
  required = false,
}: {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly type: 'text' | 'email';
  readonly required?: boolean;
}) {
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="block text-tiny font-medium text-foreground/80">
        {label}
      </span>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
      />
    </label>
  );
}

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function ChannelCard({
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
      className="block rounded-2xl border border-border bg-card p-6 transition-colors hover:border-signal-500"
    >
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-signal-500">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">
            {title}
          </p>
          <p className="mt-1 font-display text-base font-medium text-foreground">
            {value}
          </p>
        </div>
      </div>
    </a>
  );
}
