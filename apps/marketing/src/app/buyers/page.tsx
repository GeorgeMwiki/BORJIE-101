import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocaleFromCookie } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Borjie for buyers — verified Tanzanian minerals',
  description:
    'Borjie for mineral buyers and off-takers. KYB-verified sellers, chain-of-custody assays, biometric contract signing. Live marketplace from Geita, Mererani, Kahama, Mbeya.',
};

export default async function BuyersPage() {
  const locale = await getLocaleFromCookie();
  const t = getMessages(locale);

  const sw = locale === 'sw';

  const valueProps = [
    {
      title: sw ? 'Asili iliyothibitishwa' : 'Verified provenance',
      body: sw
        ? 'Kila kifurushi cha madini kinapata mnyororo wa ushahidi tangu shimo la kuchimbia hadi pima ya mizani.'
        : 'Every ore parcel carries a chain-of-custody trail from drill-hole to weighbridge.',
    },
    {
      title: sw ? 'Wauzaji wameaminika' : 'KYB-verified sellers',
      body: sw
        ? 'Borjie inakagua kila leseni ya PML/PL/ML, NIDA ya mmiliki, na hali ya TRA kabla mauzaji hayajaweza kuorodhesha.'
        : 'Borjie audits every PML/PL/ML licence, owner NIDA, and TRA standing before a seller can list.',
    },
    {
      title: sw ? 'Vyeti vya assay vya LBMA' : 'LBMA-grade assay certificates',
      body: sw
        ? 'Vipimo vya dhahabu, tanzanite, coltan na shaba kutoka maabara zilizoidhinishwa kimataifa.'
        : 'Gold, tanzanite, coltan, copper grades from internationally accredited labs.',
    },
    {
      title: sw ? 'Mikataba ya kidijitali' : 'Biometric off-take contracts',
      body: sw
        ? 'Sahihi za alama ya kidole zisizoweza kupingwa — mikataba inashikamana mahakamani.'
        : 'Non-repudiable fingerprint signatures — contracts enforceable in court.',
    },
  ] as const;

  const regions = [
    sw ? 'Geita (dhahabu)' : 'Geita (gold)',
    sw ? 'Mererani (tanzanite)' : 'Mererani (tanzanite)',
    sw ? 'Kahama (coltan)' : 'Kahama (coltan)',
    sw ? 'Mbeya (shaba)' : 'Mbeya (copper)',
    sw ? 'Tunduru (vito)' : 'Tunduru (gemstones)',
    sw ? 'Chunya (doré)' : 'Chunya (doré)',
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav locale={locale} />
      <main className="mx-auto max-w-6xl px-6 py-20">
        <header className="mb-16 max-w-3xl">
          <p className="mb-4 text-sm uppercase tracking-widest text-accent">
            {sw ? 'Kwa Wanunuzi wa Madini' : 'For mineral buyers'}
          </p>
          <h1 className="font-display text-5xl font-bold tracking-tight md:text-6xl">
            {sw
              ? 'Pata madini ya Tanzania yaliyothibitishwa.'
              : 'Source verified Tanzanian minerals. End-to-end.'}
          </h1>
          <p className="mt-6 text-xl text-foreground/70">
            {sw
              ? 'KYB ya wauzaji, mnyororo wa ushahidi wa kemikali, mikataba ya alama ya kidole.'
              : 'KYB-verified sellers, chain-of-custody assays, biometric contract signing. Buy with confidence.'}
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/pilot?role=buyer"
              className="rounded-md bg-primary px-6 py-3 font-semibold text-background hover:bg-accent"
            >
              {sw ? 'Jisajili kununua' : 'Sign up to buy'}
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-border px-6 py-3 font-semibold hover:bg-surface"
            >
              {sw ? 'Bei na ada' : 'Pricing & fees'}
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {valueProps.map((v) => (
            <div key={v.title} className="rounded-lg border border-border bg-surface/40 p-6">
              <h2 className="mb-2 font-display text-xl font-semibold">{v.title}</h2>
              <p className="text-foreground/70">{v.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-20">
          <h2 className="mb-6 font-display text-3xl font-bold">
            {sw ? 'Mikoa ya uchimbaji' : 'Currently sourced from'}
          </h2>
          <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
            {regions.map((r) => (
              <li key={r} className="rounded-md border border-border bg-background px-4 py-2">
                {r}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-20 rounded-lg border border-accent/40 bg-surface/30 p-8 text-center">
          <p className="text-sm uppercase tracking-widest text-accent">
            {sw ? 'Ada ya soko' : 'Marketplace fee'}
          </p>
          <p className="mt-4 font-display text-4xl font-bold">2.5%</p>
          <p className="mt-2 text-foreground/70">
            {sw
              ? 'Bila ada ya uanachama. Bure kuvinjari na kutoa bei. Ada inalipwa tu wakati mauzo yanapokamilika.'
              : 'No subscription. Free to browse and bid. Fee paid only on settled deals.'}
          </p>
        </section>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
