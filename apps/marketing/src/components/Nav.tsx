import Link from 'next/link';
import { LanguageToggle } from './LanguageToggle';
import { getMessages, type Locale } from '@/lib/i18n';

interface WordmarkProps {
  readonly size?: 'sm' | 'md' | 'lg';
  /** When true, paints the wordmark with the brand gradient. */
  readonly premium?: boolean;
}
function Wordmark({ size = 'md', premium = false }: WordmarkProps) {
  const cls = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';
  const tone = premium
    ? 'bg-gradient-to-r from-[oklch(0.78_0.16_75)] to-[oklch(0.58_0.12_65)] bg-clip-text text-transparent'
    : '';
  return (
    <span className={`font-display font-bold tracking-tight ${cls} ${tone}`}>Borjie</span>
  );
}
interface LogomarkProps {
  readonly size?: number;
  readonly className?: string;
}
function Logomark({ size = 24, className = '' }: LogomarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block rounded-md ${className}`}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(135deg, oklch(0.58 0.12 65), oklch(0.78 0.16 75))',
      }}
    />
  );
}

/**
 * Marketing-site top navigation. Sticky, subtle bottom border, restrained
 * CTA hierarchy. Six items: Product, Pricing, Pilot, Docs, Sign in,
 * plus the bilingual sw/en toggle on the right.
 */
export function Nav({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).nav;
  const items = [
    { href: '/#product', label: t.product },
    { href: '/buyers', label: t.buyers },
    { href: '/pricing', label: t.pricing },
    { href: '/pilot', label: t.pilot },
    { href: '/docs', label: t.docs },
  ];

  // Owner cockpit lives on a different origin (port 3010 in dev). The
  // marketing site never owns auth — Sign In + Start free trial both
  // bounce to owner-web. The env override lets prod point at the live
  // cockpit while dev falls back to localhost.
  const ownerWebUrl =
    process.env['NEXT_PUBLIC_OWNER_WEB_URL'] ?? 'http://localhost:3010';
  const signInHref = `${ownerWebUrl}/sign-in`;
  const signupHref = `${ownerWebUrl}/signup`;

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
          <a
            href={signInHref}
            className="hidden rounded-md px-3 py-2 text-sm font-medium text-neutral-400 transition-colors duration-fast hover:bg-accent hover:text-foreground sm:inline-block"
          >
            {t.signIn}
          </a>
          <a
            href={signupHref}
            className="rounded-md bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-fast ease-out hover:bg-signal-400 hover:shadow-md active:scale-[0.98]"
          >
            {t.pilot}
          </a>
        </div>
      </nav>
    </header>
  );
}
