'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getMessages, type Locale } from '@/lib/i18n';

/**
 * BrainClaimsBanner — single-row band that sits below the hero, rotating
 * through three notable mining claims every 6s with a fade transition.
 * Each claim has a deep-dive link that opens an evidence page (stubs OK
 * for now).
 *
 * Honours prefers-reduced-motion: pauses auto-rotation and renders the
 * first claim statically when reduced. Pause-on-hover for keyboard /
 * mouse users too.
 */

interface BannerProps {
  readonly locale: Locale;
}

export function BrainClaimsBanner({ locale }: BannerProps) {
  const t = getMessages(locale).brainBanner;
  const claims = t.claims;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }, []);

  useEffect(() => {
    if (reducedMotion || paused || claims.length <= 1) return;
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % claims.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion, claims.length]);

  const claim = claims[active] ?? claims[0];
  if (!claim) return null;

  return (
    <section
      className="relative mx-auto max-w-7xl px-6 py-6 lg:px-8"
      aria-label={t.kicker}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-surface/70 px-5 py-4 backdrop-blur-sm sm:px-7 sm:py-5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, oklch(0.78 0.17 78 / 0.55), transparent)',
          }}
        />
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-signal-500/30 bg-signal-500/10 text-signal-500 sm:mt-0">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
                {t.kicker}
              </p>
              <AnimatePresence mode="wait">
                <motion.div
                  key={claim.id}
                  initial={
                    reducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                  transition={{ duration: reducedMotion ? 0 : 0.4, ease: 'easeOut' }}
                  className="mt-1.5 min-w-0"
                >
                  <p className="text-base font-semibold leading-snug text-foreground sm:text-lg">
                    {claim.title}
                  </p>
                  <p className="mt-1 max-w-prose-wider text-sm leading-relaxed text-neutral-400">
                    {claim.body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-start sm:self-center">
            <Link
              href={claim.href}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 text-xs font-semibold uppercase tracking-wide text-signal-500 transition-colors hover:bg-signal-500/20 focus:outline-none focus:ring-2 focus:ring-signal-500 focus:ring-offset-2 focus:ring-offset-background"
            >
              {t.deepDive}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <div
              className="flex items-center gap-1"
              role="tablist"
              aria-label={t.kicker}
            >
              {claims.map((c, i) => {
                const isActive = i === active;
                return (
                  <button
                    type="button"
                    key={c.id}
                    role="tab"
                    aria-selected={isActive}
                    aria-label={c.title}
                    onClick={() => setActive(i)}
                    className={`h-1.5 rounded-full transition-all focus:outline-none focus:ring-2 focus:ring-signal-500 ${
                      isActive
                        ? 'w-6 bg-signal-500'
                        : 'w-1.5 bg-neutral-500/40 hover:bg-neutral-400/60'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
