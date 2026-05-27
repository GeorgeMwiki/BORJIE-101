'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * LazyVisible — IntersectionObserver gate. Renders nothing (just a
 * placeholder div) until the user scrolls within `rootMargin` of the
 * element, then mounts the children. Pairs with React.lazy / dynamic
 * imports so heavy below-fold sections never enter the initial JS
 * payload.
 *
 * Provides a `placeholderClassName` (height-only) so we can pre-reserve
 * vertical space and avoid layout shift before the chunk mounts.
 */
export interface LazyVisibleProps {
  readonly children: ReactNode;
  readonly rootMargin?: string;
  readonly placeholderClassName?: string;
}

export function LazyVisible({
  children,
  rootMargin = '400px',
  placeholderClassName = 'min-h-[480px]',
}: LazyVisibleProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setVisible(true);
          observer.disconnect();
          return;
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  if (visible) return <>{children}</>;
  return <div ref={ref} aria-hidden="true" className={placeholderClassName} />;
}
