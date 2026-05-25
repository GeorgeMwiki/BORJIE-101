'use client';

/**
 * ClientOnly — render children only after the browser has mounted.
 *
 * Used by primitives whose underlying library hard-depends on `window`
 * / `document` (react-vega, react-leaflet, FullCalendar, react-pdf).
 *
 * The package targets both Next.js (SSR) and Vite (CSR-only) consumers,
 * so we cannot import `next/dynamic` here. The `useEffect`-driven
 * mount guard gives the same SSR-safe behaviour without the framework
 * dependency.
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
