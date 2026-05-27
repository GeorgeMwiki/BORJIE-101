import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Careers at Borjie — build AI for Tanzanian mining',
  description:
    'Open roles at Borjie: site engineers, AI engineers, compliance leads. Dar es Salaam HQ, field deployments across Tanzania. Swahili-first product, world-class engineering.',
};

interface Role {
  readonly title: string;
  readonly location: string;
  readonly type: string;
  readonly summary: string;
}

const ROLES: ReadonlyArray<Role> = [
  {
    title: 'Senior Software Engineer — Master Brain',
    location: 'Dar es Salaam · Hybrid',
    type: 'Full-time',
    summary:
      'Own the Master Brain orchestration layer — persona modes, junior dispatch, evidence-cited replies. TypeScript + Anthropic Claude + Postgres + Drizzle. Mining-domain literacy is a strong plus.',
  },
  {
    title: 'Mining Operations Engineer',
    location: 'Geita / Mererani / Kahama — rotational',
    type: 'Full-time',
    summary:
      'Embed with pilot tenants. Walk drill rigs, weighbridges, assay labs. Translate field reality back into product. Geology, metallurgy, or mine-management background required.',
  },
  {
    title: 'Compliance & Regulatory Lead',
    location: 'Dodoma · Dar es Salaam',
    type: 'Full-time',
    summary:
      'Own the Tumemadini, NEMC, and BoT reporting cadences inside Borjie. Audit-hash chains, returns calendars, two-operator approvals. Tanzanian mining law / accounting background.',
  },
  {
    title: 'Frontend Engineer — Owner Portal',
    location: 'Dar es Salaam · Remote-friendly',
    type: 'Full-time',
    summary:
      'Ship the owner cockpit: licence calendar, ore-parcel ledger, FX desk, marketplace. Next.js 15, Tailwind v4, OKLCH design tokens. Bilingual UI experience welcome.',
  },
];

export default async function CareersPage() {
  const locale = await getLocale();

  return (
    <>
      <Nav locale={locale} />
      <main id="main-content" className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8">
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          Careers
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          Build the AI that runs Tanzanian mining.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-neutral-300">
          Borjie is hiring across engineering, field operations, and
          compliance. Dar es Salaam headquarters, deployments across the
          country. Competitive cash, meaningful equity, and a chance to
          rebuild a sector that funds Tanzania.
        </p>

        <div className="mt-12 space-y-6">
          {ROLES.map((role) => (
            <article
              key={role.title}
              className="rounded-lg border border-border bg-surface/40 p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">
                  {role.title}
                </h2>
                <span className="font-mono text-pill uppercase tracking-widest text-neutral-400">
                  {role.type}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-signal-500">
                {role.location}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-neutral-400">
                {role.summary}
              </p>
              <a
                href={`mailto:careers@borjie.co.tz?subject=${encodeURIComponent(
                  role.title,
                )}`}
                className="mt-4 inline-block text-sm font-semibold text-signal-500 hover:text-signal-400"
              >
                Apply →
              </a>
            </article>
          ))}
        </div>

        <div className="mt-16 rounded-lg border border-accent/40 bg-surface/30 p-6 text-center">
          <p className="text-sm text-foreground/70">
            Don&apos;t see your role? Send your CV and a 200-word note on
            what you&apos;d build at Borjie to{' '}
            <a
              href="mailto:careers@borjie.co.tz"
              className="font-semibold text-signal-500 hover:text-signal-400"
            >
              careers@borjie.co.tz
            </a>
            .
          </p>
        </div>

        <div className="mt-12">
          <Link
            href="/about"
            className="text-sm text-neutral-400 hover:text-foreground"
          >
            ← About Borjie
          </Link>
        </div>
      </main>
      <Footer locale={locale} />
    </>
  );
}
