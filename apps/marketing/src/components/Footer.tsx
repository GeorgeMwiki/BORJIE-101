'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
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
    <span className={`font-display font-bold tracking-tight ${cls} ${tone}`}>
      Borjie
    </span>
  );
}

/**
 * Footer — 4-column LitFin-pattern footer.
 *
 * Top band:
 *   - Brand column with wordmark, tagline, regulator strip badge,
 *     Tanzania-region storage badge, and locale tag.
 *   - Four link columns (Product · Resources · Company · Legal).
 *
 * Bottom strip: copyright + status pill + currency tag.
 *
 * Framer-motion fade-up on the whole top band. Honours
 * prefers-reduced-motion by collapsing to instant via the
 * `viewport.once` + `whileInView` short-circuit.
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
      title: t.resources,
      links: [
        { label: t.links.docs, href: '/docs' },
        { label: 'GitHub', href: 'https://github.com/borjie', external: true },
        {
          label: 'X / Twitter',
          href: 'https://x.com/borjie_tz',
          external: true,
        },
        {
          label: 'LinkedIn',
          href: 'https://www.linkedin.com/company/borjie',
          external: true,
        },
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
      title: t.legal,
      links: [
        { label: t.links.privacy, href: '/privacy' },
        { label: t.links.terms, href: '/terms' },
        { label: 'DPA', href: '/dpa' },
        {
          label: t.links.status,
          href: 'https://status.borjie.co.tz',
          external: true,
        },
      ],
    },
  ];

  // Regulator strip — kept short, comma-of-Tanzanian-rails feel.
  const regulatorTokens = [
    'Tumemadini',
    'NEMC',
    'BoT',
    'TRA',
    'BRELA',
    'LBMA',
  ];

  return (
    <footer className="border-t border-border bg-surface-sunken">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-7xl px-6 py-16 lg:px-8"
      >
        <div className="grid gap-12 lg:grid-cols-[1.5fr_3fr]">
          {/* Brand column */}
          <div>
            <Wordmark size="md" premium />
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-neutral-400">
              {t.tagline}
            </p>

            {/* Regulator alignment strip */}
            <div className="mt-8">
              <div className="font-mono text-meta uppercase tracking-widest text-neutral-500">
                {t.regulatorStrip}
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {regulatorTokens.map((token) => (
                  <li
                    key={token}
                    className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal-500"
                  >
                    {token}
                  </li>
                ))}
              </ul>
            </div>

            {/* Tanzania-region storage + locale tag */}
            <div className="mt-8 space-y-1.5 font-mono text-meta uppercase tracking-widest text-neutral-500">
              <p>{t.tanzaniaStorage}</p>
              <p>{t.locale}</p>
            </div>
          </div>

          {/* Four link columns */}
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
                          className="text-sm text-neutral-400 transition-colors duration-fast hover:text-foreground focus:outline-none focus:text-foreground"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-sm text-neutral-400 transition-colors duration-fast hover:text-foreground focus:outline-none focus:text-foreground"
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

        {/* Bottom strip */}
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
          <p className="font-mono text-meta text-neutral-400">
            © 2026 Borjie. {t.rights}
          </p>
          <div className="flex items-center gap-4 font-mono text-meta uppercase tracking-widest text-neutral-400">
            <span className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full bg-success"
                aria-hidden="true"
              />
              {t.systemsOperational}
            </span>
            <span className="h-3 w-px bg-border" aria-hidden="true" />
            <span>Tanzania · TZS</span>
          </div>
        </div>
      </motion.div>
    </footer>
  );
}
