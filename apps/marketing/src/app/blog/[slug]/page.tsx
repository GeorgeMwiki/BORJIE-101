import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Twitter,
  Linkedin,
  Link2,
} from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { notFound } from 'next/navigation';

/**
 * /blog/[slug] , LitFin-parity post template.
 *
 * No MDX posts ship in this wave; every slug resolves to a `notFound()`
 * until the editorial MDX pipeline lands. The scaffold below documents
 * the eventual DOM shape so wiring the loader is a single-file diff:
 * replace the `notFound()` with a loader call, hydrate the slots from
 * the loader output, and the rest of the rendering tree is already in
 * production discipline (Nav, hero, type ramp, share rail, related,
 * final CTA, Footer).
 *
 * LitFin DNA mirrored per `Docs/DESIGN/LITFIN_MARKETING_SECONDARY_SPEC.md`
 * section 3:
 *   - centered hero with kicker, title, byline, dateline, read-time
 *   - `max-w-prose` body with prose-mining type ramp
 *   - sticky left share rail on lg+
 *   - related-posts grid (3-up)
 *   - final CTA band routing to /signup
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug} , Borjie blog`,
    description: 'Field notes from Tanzanian mining.',
    robots: { index: false, follow: false },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await params;
  const locale = await getLocale();
  const t = getMessages(locale).blog;

  // No posts live yet , surface the 404 template so URL enumeration
  // doesn't expose unfinished slugs. The scaffold below is the
  // production template ready for the MDX hookup.
  notFound();

  // Unreachable scaffold below documents the eventual DOM shape so the
  // future MDX hookup is one edit instead of an architectural refactor.
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        {/* Post hero */}
        <section className="relative overflow-hidden border-b border-border/40">
          <div
            className="absolute inset-0 cinematic-grid opacity-20"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-prose px-6 py-20 lg:px-8 lg:py-24">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t.backToBlog}
            </Link>
            <p className="mt-8 font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.featuredKicker}
            </p>
            <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
              Post title
            </h1>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
              <span>{t.authorBy} Borjie team</span>
              <span aria-hidden="true">,</span>
              <span>5 {t.minRead}</span>
            </div>
          </div>
        </section>

        {/* Body + sticky share rail */}
        <section className="relative mx-auto max-w-6xl px-6 py-16 lg:px-8 lg:py-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[64px_1fr]">
            <aside
              className="hidden lg:sticky lg:top-24 lg:block lg:h-fit"
              aria-label="Share rail"
            >
              <div className="flex flex-col gap-2">
                <ShareLink
                  href="https://twitter.com/intent/tweet"
                  Icon={Twitter}
                  label="Twitter"
                />
                <ShareLink
                  href="https://www.linkedin.com/shareArticle"
                  Icon={Linkedin}
                  label="LinkedIn"
                />
                <ShareLink href="#" Icon={Link2} label="Copy link" />
              </div>
            </aside>
            <article className="prose-mining max-w-prose text-base leading-relaxed text-neutral-300">
              <p>
                Body type ramp goes here. The MDX loader hydrates this slot
                with real content.
              </p>
              <h2>Section heading</h2>
              <p>Sustained two-column read pattern, max-w-prose.</p>
              <h3>Sub-heading</h3>
              <p>Inline code spans render in font-mono text-sm.</p>
            </article>
          </div>
        </section>

        {/* Related posts , 3-up grid */}
        <section
          className="border-t border-border bg-surface/40 px-5 py-16 md:py-20"
          aria-labelledby="related-posts"
        >
          <div className="mx-auto max-w-5xl">
            <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
              {t.kicker}
            </p>
            <h2
              id="related-posts"
              className="mt-3 font-display text-3xl font-medium tracking-tight text-balance"
            >
              {locale === 'sw' ? 'Yanayohusiana' : 'Related posts'}
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
                    {t.kicker}
                  </p>
                  <h3 className="mt-2 font-display text-lg font-medium text-foreground">
                    Related post {i}
                  </h3>
                  <p className="mt-2 text-sm text-neutral-400">{t.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA band routing to /signup */}
        <section className="border-t border-border px-5 py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              {t.subscribeHeading}
            </h2>
            <p className="mx-auto mt-3 max-w-prose-wider text-base leading-relaxed text-neutral-400">
              {t.subscribeSub}
            </p>
            <div className="mt-8 inline-flex">
              <Link
                href="/signup"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-signal-500 px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 active:scale-[0.98]"
              >
                {locale === 'sw' ? 'Anza sasa' : 'Get started'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer locale={locale} />
    </>
  );
}

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

function ShareLink({
  href,
  Icon,
  label,
}: {
  readonly href: string;
  readonly Icon: IconComponent;
  readonly label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-neutral-400 transition-colors hover:border-signal-500 hover:text-signal-400"
    >
      <Icon className="h-4 w-4" />
    </a>
  );
}
