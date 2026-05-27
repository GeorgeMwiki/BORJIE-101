'use client';

/**
 * ClientOnly — gates a subtree until the browser has mounted.
 *
 * Mirrors `packages/graph-viz/src/components/ClientOnly.tsx` so we
 * stay independent of `@borjie/genui` at build time. Every view that
 * touches `window`, `localStorage`, `IntersectionObserver`, `virtua`,
 * or `dnd-kit` is wrapped because Next.js 15.5 evaluates server-side
 * and those libraries hard-depend on browser globals.
 *
 * Source — React 19 SSR guide
 * <https://react.dev/learn/render-and-commit#step-3-react-commits-changes-to-the-dom>
 * checked 2026-04-12.
 */

import { useEffect, useState, type ReactNode } from 'react';

export interface ClientOnlyProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

export function ClientOnly({ children, fallback }: ClientOnlyProps): JSX.Element {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{fallback ?? null}</>;
  }
  return <>{children}</>;
}
