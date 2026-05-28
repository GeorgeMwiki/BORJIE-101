'use client';

import * as React from 'react';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTheme, type Theme } from './ThemeProvider';

/**
 * ThemeToggle — three-state cycle (light → dark → system → light) with
 * a Sun / Moon / Monitor icon. Designed for navigation rails (marketing
 * nav cluster, owner-portal TopBar, admin-console TopBar) and is
 * bilingual sw/en out of the box.
 *
 * The toggle is a single 36px icon button — no dropdown menu. Cycling
 * keeps the affordance compact, and reach to all three states is one or
 * two clicks, which the LitFin nav has proven is enough. A long-press /
 * right-click could expose an explicit picker; for now keep parity.
 *
 * SSR safety: on first render before `mounted`, the button shows a
 * neutral monitor icon so hydration never mismatches.
 */

const ORDER: readonly Theme[] = ['light', 'dark', 'system'] as const;

function nextTheme(current: Theme): Theme {
  const idx = ORDER.indexOf(current);
  return ORDER[(idx + 1) % ORDER.length]!;
}

const ICON_FOR_THEME: Readonly<Record<Theme, LucideIcon>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const LABEL_FOR_THEME: Readonly<Record<Theme, { en: string; sw: string }>> = {
  light: { en: 'Light theme', sw: 'Mwanga' },
  dark: { en: 'Dark theme', sw: 'Giza' },
  system: { en: 'System theme', sw: 'Mfumo' },
};

export interface ThemeToggleProps {
  readonly locale?: 'en' | 'sw';
  readonly className?: string;
}

export function ThemeToggle({
  locale = 'en',
  className,
}: ThemeToggleProps): JSX.Element {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleClick = useCallback(() => {
    setTheme(nextTheme(theme));
  }, [theme, setTheme]);

  const display = mounted ? theme : 'system';
  const Icon = ICON_FOR_THEME[display];
  const nextLabel = LABEL_FOR_THEME[nextTheme(display)][locale];
  const switchVerb = locale === 'sw' ? 'Badilisha kwenda' : 'Switch to';

  const ariaLabel = useMemo(
    () => `${switchVerb} ${nextLabel.toLowerCase()}`,
    [switchVerb, nextLabel],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      data-theme-state={display}
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center rounded-xl',
        'border border-border/60 bg-surface text-foreground',
        'transition-all duration-200',
        'hover:bg-surface-raised hover:border-border-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="sr-only">{ariaLabel}</span>
    </button>
  );
}
