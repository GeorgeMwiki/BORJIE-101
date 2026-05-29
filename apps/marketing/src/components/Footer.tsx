'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Mail, MapPin, ShieldCheck } from 'lucide-react';
import { getMessages, type Locale } from '@/lib/i18n';
import { BorjieLogo } from '@borjie/design-system';

interface WordmarkProps {
  readonly size?: 'sm' | 'md' | 'lg';
  readonly premium?: boolean;
}
/**
 * Footer wordmark — delegates to the canonical `BorjieLogo` horizontal
 * lockup. Size variants map to BorjieLogo's pixel sizing so the footer
 * stays visually in sync with the nav and the rest of the brand
 * surface.
 */
function Wordmark({ size = 'md', premium = false }: WordmarkProps) {
  const px = size === 'sm' ? 20 : size === 'lg' ? 36 : 26;
  return (
    <BorjieLogo
      variant="lockup-horizontal"
      size={px}
      tone={premium ? 'full' : 'mono-cream'}
    />
  );
}

/**
 * Footer — LitFin MarketingFooter parity, ported to the Borjie navy +
 * gold palette and the mining audience taxonomy.
 *
 * Composition (top → bottom):
 *   1. Elevated rounded-panel container with subtle shadow and inner
 *      hairline grid (mirrors LitFin's nested brand-card pattern).
 *   2. Brand row: wordmark + tagline on the left, contact chips on the
 *      right (mailto + Dar es Salaam location).
 *   3. Six-column grid: compliance callout (left, spans 2) + four link
 *      columns + audience column.
 *   4. Bottom strip: compliance badge + copyright + locale tag.
 *
 * Framer-motion fade-up on the whole top band. Honours
 * prefers-reduced-motion via the underlying motion engine.
 */
export function Footer({ locale }: { readonly locale: Locale }) {
  const t = getMessages(locale).footer;
  const nav = getMessages(locale).nav;

  const cols: ReadonlyArray<{
    readonly title: string;
    readonly links: ReadonlyArray<{
      readonly label: string;
      readonly href: string;
      readonly external?: boolean;
    }>;
  }> = [
    {
      title: t.product,
      links: [
        { label: t.links.capabilities, href: '/#product' },
        { label: t.links.masterBrain, href: '/#brief' },
        { label: t.links.autonomy, href: '/#product' },
        { label: t.links.auditChain, href: '/#product' },
        { label: t.links.pricing, href: '/pricing' },
      ],
    },
    {
      title: t.audience,
      links: [
        { label: nav.items.pml, href: '/for-pml' },
        { label: nav.items.ml, href: '/for-ml' },
        { label: nav.items.sml, href: '/for-sml' },
        { label: nav.items.cooperatives, href: '/for-cooperatives' },
        { label: nav.items.buyers, href: '/buyers' },
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
        { label: t.links.about, href: '/about' },
        { label: t.links.pilot, href: '/pilot' },
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

  return (
    <footer className="relative border-t border-border bg-surface-sunken">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ duration: 0.4 }}
        className="mx-auto max-w-container px-4 py-16 sm:px-6"
      >
        {/* Elevated brand-card container — LitFin signature */}
        <div className="rounded-panel border border-border/60 bg-background/70 p-6 shadow-lift-soft backdrop-blur-xl md:p-10">
          {/* Brand row */}
          <div className="mb-10 flex flex-col gap-4 border-b border-border/60 pb-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Wordmark size="lg" premium />
              <p className="mt-4 text-sm leading-relaxed text-neutral-400">
                {t.tagline}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={`mailto:${t.contactEmail}`}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-2 text-sm text-neutral-300 transition-colors hover:border-signal-500/40 hover:text-foreground"
              >
                <Mail className="h-4 w-4" aria-hidden />
                {t.contactEmail}
              </a>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-2 text-sm text-neutral-300">
                <MapPin className="h-4 w-4" aria-hidden />
                {t.contactLocation}
              </div>
            </div>
          </div>

          {/* Six-column grid: compliance callout + link columns */}
          <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-6">
            {/* Compliance callout — sits in the first column on lg+ */}
            <div className="col-span-2 md:col-span-3 lg:col-span-1">
              <div className="rounded-3xl border border-signal-500/25 bg-signal-500/10 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-signal-500" aria-hidden />
                  <span className="font-mono text-tiny font-semibold uppercase tracking-widest text-signal-500">
                    {t.complianceBadge}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-neutral-300">
                  {t.tanzaniaStorage}
                </p>
                <div className="mt-4 font-mono text-tiny uppercase tracking-widest text-neutral-500">
                  {t.regulatorStrip}
                </div>
              </div>
            </div>

            {/* Link columns */}
            {cols.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="mb-4 text-sm font-semibold text-foreground">
                  {col.title}
                </h3>
                <ul className="space-y-2.5">
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
      </motion.div>

      {/* Bottom strip */}
      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-container flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 font-mono text-tiny uppercase tracking-widest text-success">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
              {t.systemsOperational}
            </span>
          </div>
          <div className="flex flex-col items-start gap-2 font-mono text-tiny uppercase tracking-widest text-neutral-400 sm:flex-row sm:items-center sm:gap-4">
            <span>© 2026 Borjie. {t.rights}</span>
            <span aria-hidden className="hidden h-3 w-px bg-border/60 sm:inline-block" />
            <span>Tanzania · TZS-first · {t.locale}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
