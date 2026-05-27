'use client';

/**
 * ClientOnly — render children only after the browser has mounted.
 *
 * Mirrors the pattern in `@borjie/genui` so this package is
 * independent of genui at build-time. Every viz adapter wraps its
 * native canvas in <ClientOnly> because Cytoscape, sigma, vis-network
 * and react-flow all hard-depend on `window`.
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
