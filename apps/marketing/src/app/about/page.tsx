import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'About Borjie — built in Tanzania for Tanzanian mining',
  description:
    'Borjie is an AI-native operating system for Tanzanian mining. Built in Dar es Salaam, designed for owners, operators, regulators, and buyers — Swahili-first, audit-grade, deployable in days.',
};

const SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Why Borjie exists',
    body:
      "Tanzanian mining loses millions a year to paper licences, broken FX desks, missing assay records, and compliance letters that never reach the Mining Commission or NEMC on time. Borjie collapses that entire stack into one AI-native operating system — Mr. Mwikila, your AI Mining Managing Director, runs the business end-to-end alongside the owner.",
  },
  {
    title: 'Who we serve',
    body:
      "PML, PL, and ML licence holders across Geita, Mererani, Kahama, Mbeya, Tunduru and Chunya. Site supervisors logging drill-holes from the field. Treasury teams hedging USD/TZS. Compliance officers filing Mining Commission returns. And the buyers on the other side of every ore parcel — KYB-verified, biometrically signed, settled on-chain-of-custody.",
  },
  {
    title: 'How we build',
    body:
      "Borjie is multi-tenant by design. Every query is scoped by tenant id end-to-end. Storage is Tanzania-regional, encrypted at rest, with audit-hash chains on every regulatory artifact. We default to Swahili and toggle to English — two languages, one source of truth. Open-source where we can be, proprietary where compliance demands.",
  },
  {
    title: 'Where we are based',
    body:
      "Headquartered in Dar es Salaam, with field engineers across the Lake Zone, Manyara, and the Southern Highlands. Our team is Tanzanian-led, mining-experienced, and obsessed with closing the gap between regulators, owners, and global buyers.",
  },
];

export default async function AboutPage() {
  const locale = await getLocale();

  return (
    <>
      
      <main id="main-content" className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          About
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          The AI operating system for Tanzanian mining.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-foreground/75">
          Borjie is built in Dar es Salaam, for the mining sector that pays
          our country's bills. We replace paper licences, broken FX desks,
          and ad-hoc compliance with one Master Brain that runs the
          business with the owner.
        </p>

        <div className="mt-12 space-y-8 text-sm leading-relaxed text-foreground/70">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="font-display text-xl font-semibold text-foreground">
                {s.title}
              </h2>
              <p className="mt-3">{s.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-16 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-signal-500 px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-signal-400"
          >
            Get started
          </Link>
          <Link
            href="/buyers"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-surface"
          >
            For mineral buyers
          </Link>
        </div>
      </main>
      
    </>
  );
}
