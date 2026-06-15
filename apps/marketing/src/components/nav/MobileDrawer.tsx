'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { LanguageToggle } from '../LanguageToggle';
import { ThemeToggle } from '@borjie/design-system';
import { BorjieLogo } from '@borjie/design-system';
import type { Locale } from '@/lib/i18n';
import type { AudienceCategory, NavMessages, PrimaryLink } from './types';
import { useFocusTrap } from './useFocusTrap';

interface MobileDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly categories: readonly AudienceCategory[];
  readonly primaryLinks: readonly PrimaryLink[];
  readonly messages: NavMessages;
  readonly locale: Locale;
  readonly pathname: string;
  readonly signInHref: string;
  readonly ctaHref: string;
}

/**
 * Mobile navigation sheet — a focus-trapped, body-scroll-locked drawer
 * that slides in from the right with a dimmed backdrop. Closes on
 * Escape, backdrop tap, or any link tap. Motion is gated by
 * `prefers-reduced-motion` (cross-fade only, no slide). The dense
 * audience matrix is presented as labelled groups so a thumb can reach
 * every segment.
 */
export function MobileDrawer({
  open,
  onClose,
  categories,
  primaryLinks,
  messages,
  locale,
  pathname,
  signInHref,
  ctaHref,
}: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  useFocusTrap(panelRef, open);

  // Escape closes the sheet.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cats = messages.categories;
  const items = messages.items;

  const groupLabel =
    'mb-1.5 px-1 text-tiny font-semibold uppercase tracking-widest text-foreground/55';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label={messages.closeMenu}
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default bg-background/60 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={messages.menu}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-border bg-card shadow-lift-medium"
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 text-foreground">
              <BorjieLogo
                variant="lockup-horizontal"
                size={26}
                tone="full"
                pulse={false}
                // Wordmark follows the drawer foreground so it stays legible on
                // the light card surface; the gold mark keeps its tone.
                wordmarkColor="currentColor"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label={messages.closeMenu}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors duration-150 ease-out hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {/* Primary links */}
              <ul className="space-y-0.5">
                {primaryLinks.map((link) => {
                  const active =
                    pathname === link.href ||
                    pathname.startsWith(`${link.href}/`);
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'block rounded-lg px-3 py-2.5 text-base font-medium transition-colors duration-150 ease-out',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                          active
                            ? 'bg-surface-raised text-signal-500'
                            : 'text-foreground hover:bg-surface-raised',
                        ].join(' ')}
                      >
                        {messages[link.labelKey]}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* Audience groups */}
              <div className="mt-4 space-y-4">
                {categories.map((cat) => (
                  <div key={cat.titleKey}>
                    <div className={groupLabel}>{cats[cat.titleKey]}</div>
                    <ul className="space-y-0.5">
                      {cat.items.map((item) => {
                        const Icon = item.icon;
                        const active = pathname === item.href;
                        const titleKey = item.id as keyof typeof items;
                        return (
                          <li key={item.id}>
                            <Link
                              href={item.href}
                              onClick={onClose}
                              aria-current={active ? 'page' : undefined}
                              className={[
                                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ease-out',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                                active
                                  ? 'bg-surface-raised text-signal-500'
                                  : 'text-foreground/80 hover:bg-surface-raised hover:text-foreground',
                              ].join(' ')}
                            >
                              <Icon
                                className="h-4 w-4 shrink-0 text-foreground/50"
                                strokeWidth={1.75}
                                aria-hidden
                              />
                              <span>{items[titleKey]}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer actions — pinned */}
            <div className="shrink-0 space-y-3 border-t border-border px-4 py-4">
              <div className="flex items-center justify-between">
                <LanguageToggle current={locale} />
                <ThemeToggle locale={locale} />
              </div>
              <Link
                href={ctaHref}
                onClick={onClose}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-signal-500 px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {messages.requestPilot}
              </Link>
              <a
                href={signInHref}
                onClick={onClose}
                className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors duration-150 ease-out hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {messages.signIn}
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
