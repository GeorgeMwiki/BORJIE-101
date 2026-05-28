import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { notFound } from 'next/navigation';

/**
 * /blog/[slug] , LitFin-parity post template.
 *
 * Renders an MDX-free template that will pick up real posts once the
 * Borjie editorial pipeline lands. For now every slug resolves to a
 * `notFound()` so the 404 surface (`apps/marketing/src/app/not-found.tsx`)
 * handles the visit consistently.
 *
 * The layout below ships only as a typed scaffold so the eventual
 * MDX hookup is a single-file diff: replace `notFound()` with a
 * loader and render the post inside the wrapper.
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

  // No posts are committed yet , surface the 404 template until the
  // MDX pipeline lands. Keeps slug enumeration impossible from URLs.
  notFound();

  // Unreachable scaffold below documents the eventual DOM shape so the
  // future MDX hookup is one edit instead of an architectural refactor.
  // eslint-disable-next-line @typescript-eslint/no-unreachable -- intentional scaffold
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <article className="mx-auto max-w-prose px-6 py-20 lg:px-8">
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
          <div className="mt-4 flex items-center gap-3 text-sm text-neutral-500">
            <span>
              {t.authorBy} Borjie team
            </span>
            <span aria-hidden="true">,</span>
            <span>5 {t.minRead}</span>
          </div>
          <div className="prose-mining mt-10 text-base leading-relaxed text-neutral-300">
            <p>Body type ramp here. Real MDX content replaces this scaffold.</p>
          </div>
        </article>
      </main>
      <Footer locale={locale} />
    </>
  );
}
