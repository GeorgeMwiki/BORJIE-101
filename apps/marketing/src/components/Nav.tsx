import Link from 'next/link';
import { Wordmark } from '@borjie/design-system';
import { LanguageToggle } from './LanguageToggle';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * Marketing-site top navigation. Sticky, subtle bottom border, restrained
 * CTA hierarchy. Six items: Product, Pricing, Pilot, Docs, Sign in,
 * plus the bilingual sw/en toggle on the right.
 */
export function Nav({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).nav;
  const items = [
    { href: '/#product', label: t.product },
    { href: '/pricing', label: t.pricing },
    { href: '/pilot', label: t.pilot },
    { href: '/docs', label: t.docs },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/70 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Borjie home"
          className="-ml-1 rounded-sm p-1 transition-opacity duration-fast hover:opacity-80"
        >
          <Wordmark size="sm" premium />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-neutral-400 transition-colors duration-fast hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <LanguageToggle current={locale} />
          <Link
            href="/sign-in"
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-neutral-400 transition-colors duration-fast hover:bg-accent hover:text-foreground sm:inline-block"
          >
            {t.signIn}
          </Link>
          <Link
            href="/pilot"
            className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98]"
          >
            {t.pilot}
          </Link>
        </div>
      </nav>
    </header>
  );
}
