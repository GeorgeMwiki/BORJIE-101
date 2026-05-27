import Link from 'next/link';
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
 * Footer — link columns + copyright + Tanzanian-locale tag (no flag
 * emoji per project rules; "Dar es Salaam · UTC+3" carries the place).
 *
 * Four columns: Product, Pricing, Pilot, Resources (Docs · GitHub ·
 * X · LinkedIn · Privacy · Terms). All hrefs resolve; external social
 * links open in a new tab.
 */
export function Footer({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).footer;
  const cols = [
    {
      title: t.product,
      links: [
        { label: t.links.capabilities, href: '/#product' },
        { label: t.links.masterBrain, href: '/#brief' },
        { label: t.links.autonomy, href: '/#product' },
        { label: t.links.auditChain, href: '/#product' },
      ],
    },
    {
      title: t.company,
      links: [
        { label: t.links.pricing, href: '/pricing' },
        { label: t.links.pilot, href: '/pilot' },
        { label: t.links.about, href: '/about' },
        { label: t.links.careers, href: '/careers' },
      ],
    },
    {
      title: t.resources,
      links: [
        { label: t.links.docs, href: '/docs' },
        { label: 'GitHub', href: 'https://github.com/borjie', external: true },
        { label: 'X / Twitter', href: 'https://x.com/borjie_tz', external: true },
        { label: 'LinkedIn', href: 'https://www.linkedin.com/company/borjie', external: true },
      ],
    },
    {
      title: t.legal,
      links: [
        { label: t.links.privacy, href: '/privacy' },
        { label: t.links.terms, href: '/terms' },
        { label: 'DPA', href: '/dpa' },
        { label: t.links.status, href: 'https://status.borjie.co.tz', external: true },
      ],
    },
  ];

  return (
    <footer className="border-t border-border bg-surface-sunken">
      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_3fr]">
          <div>
            <Wordmark size="md" premium />
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-neutral-400">{t.tagline}</p>
            <p className="mt-8 font-mono text-caption-lg uppercase tracking-widest text-neutral-500">
              {t.locale}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {cols.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="font-mono text-caption-lg uppercase tracking-widest text-neutral-400">
                  {col.title}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-neutral-400 transition-colors duration-fast hover:text-foreground"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-sm text-neutral-400 transition-colors duration-fast hover:text-foreground"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
          <p className="font-mono text-meta text-neutral-400">
            © 2026 Borjie. {t.rights}
          </p>
          <div className="flex items-center gap-4 font-mono text-meta uppercase tracking-widest text-neutral-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {t.systemsOperational}
            </span>
            <span className="h-3 w-px bg-border" />
            <span>Tanzania · TZS</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
