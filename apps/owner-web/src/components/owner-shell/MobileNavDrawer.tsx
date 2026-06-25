'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import {
  cn,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@borjie/design-system';
import { useT } from '@/i18n/t.client';
import { SECTIONS, bestActiveHref } from './nav-sections';
import { SidebarNav } from './Sidebar';

/**
 * Below-`lg` navigation — the cockpit nav reachable when the desktop rail is
 * collapsed (`Sidebar` is `hidden lg:flex`). A TopBar hamburger toggles a DS
 * `Drawer` (Radix Dialog) that slides in from the left and renders the SAME
 * `SidebarNav` body as the desktop rail (one route source — no link is
 * stranded). The Drawer is focus-trapped and Esc-dismissable for free
 * (Radix), and selecting any link closes it (`onNavigate`).
 *
 * Hidden from `lg` up (`lg:hidden`) so it never double-renders alongside the
 * desktop rail.
 *
 * Locale-seeded from `languagePreference` so the hamburger label, drawer
 * title, and every nav label paint the active language on first paint (no
 * EN-under-SW split-brain).
 */
export function MobileNavDrawer({
  tenantName,
  languagePreference,
}: {
  readonly tenantName: string;
  readonly languagePreference: 'sw' | 'en';
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useT(languagePreference);
  const activeHref = bestActiveHref(pathname, SECTIONS);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav.openNavigation')}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center justify-center rounded-xl p-2 text-neutral-400 lg:hidden',
          'transition-colors hover:bg-surface hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* hideCloseButton: the DS built-in close ships a hardcoded English
          "Close panel" sr-only label that would leak under an SW locale
          (zero-mix). We render our own locale-resolved close instead. */}
      <DrawerContent
        side="left"
        size="sm"
        hideCloseButton
        className="flex flex-col bg-surface/95 p-0 backdrop-blur-xl lg:hidden"
        aria-label={t('common.ownerNavigation')}
      >
        {/* Radix requires a DialogTitle for the dialog to be labelled; we keep
            it screen-reader-only so the drawer's own brand header stays the
            visible heading. */}
        <DrawerHeader className="sr-only border-0 p-0">
          <DrawerTitle>{t('common.ownerNavigation')}</DrawerTitle>
        </DrawerHeader>
        <DrawerClose
          aria-label={t('nav.closeNavigation')}
          className={cn(
            'absolute right-3 top-4 z-10 rounded-md p-1.5 text-neutral-400',
            'transition-colors hover:bg-surface hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </DrawerClose>
        <SidebarNav
          tenantName={tenantName}
          t={t}
          activeHref={activeHref}
          onNavigate={() => setOpen(false)}
        />
      </DrawerContent>
    </Drawer>
  );
}
