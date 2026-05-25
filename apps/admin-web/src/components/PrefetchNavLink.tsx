'use client';

import Link, { type LinkProps } from 'next/link';
import { type ReactNode } from 'react';
// `prefetchOnHover` warms the destination route's chunk on first
// hover/focus/touchstart via `<link rel="prefetch">`. Mirrors Next's
// viewport prefetch but on a cheaper intent signal — particularly
// valuable for sidebar nav items that may be out of viewport.
import { prefetchOnHover } from '@borjie/performance-toolkit/lazy-load';

interface PrefetchNavLinkProps extends Omit<LinkProps, 'children'> {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Client-side wrapper around `next/link` that adds hover-driven
 * prefetch. Use anywhere a server component renders a high-traffic
 * Link — `await cookies()` server components can't attach hover
 * handlers directly, so wrap the link in this component.
 */
export function PrefetchNavLink({
  href,
  children,
  className,
  ...rest
}: PrefetchNavLinkProps): JSX.Element {
  const handlers = prefetchOnHover(typeof href === 'string' ? href : href.toString());
  return (
    <Link href={href} className={className} {...rest} {...handlers}>
      {children}
    </Link>
  );
}
