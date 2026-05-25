/**
 * `prefetchOnHover` — returns a set of HTML attributes that the caller
 * spreads onto a `<Link>` / `<a>` / `<button>`. When the user hovers
 * (mouseenter) or focuses (focusin), a `<link rel="prefetch">` is
 * injected into `<head>` so the next-route bundle is already cached
 * by the time they click.
 *
 * This is the Next.js Link default behaviour — we replicate it for
 * the Vite-based owner-portal and admin-web where there is
 * no Next router.
 *
 *   <a {...prefetchOnHover('/properties')} href="/properties">Properties</a>
 *
 * Returns plain functions because we want zero React dependency.
 */

import type { PrefetchSpec } from '../types.js';

/**
 * Internal: idempotent insert of a `<link>` into document.head. We dedup
 * by href + as so multiple components hover-prefetching the same route
 * only insert one tag.
 */
export function insertResourceHint(spec: PrefetchSpec): void {
  if (typeof document === 'undefined') return;
  const rel = spec.rel ?? 'prefetch';
  const selector = `link[rel="${rel}"][href="${cssEscape(spec.href)}"]`;
  if (document.querySelector(selector)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = spec.href;
  if (spec.as !== undefined) link.setAttribute('as', spec.as);
  if (spec.crossOrigin !== undefined) link.crossOrigin = spec.crossOrigin;
  document.head.appendChild(link);
}

function cssEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

export interface PrefetchHandlers {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
}

/**
 * Build the attribute handlers for a hover-prefetch interaction. Use
 * `as: 'document'` because we want the browser to fetch the HTML, then
 * use `as: 'script'` for raw JS bundle prefetches.
 *
 *   const handlers = prefetchOnHover('/dashboard');
 *   <a href="/dashboard" {...handlers}>Dashboard</a>
 */
export function prefetchOnHover(
  href: string,
  spec?: Omit<PrefetchSpec, 'href'>,
): PrefetchHandlers {
  let triggered = false;
  const trigger = (): void => {
    if (triggered) return;
    triggered = true;
    insertResourceHint({
      href,
      rel: spec?.rel ?? 'prefetch',
      ...(spec?.as !== undefined ? { as: spec.as } : { as: 'document' }),
      ...(spec?.crossOrigin !== undefined
        ? { crossOrigin: spec.crossOrigin }
        : {}),
    });
  };
  return {
    onMouseEnter: trigger,
    onFocus: trigger,
    onTouchStart: trigger,
  };
}

/**
 * `prefetchManyOnHover` — useful for nav menus that should warm a
 * cluster of routes the first time the menu opens.
 */
export function prefetchManyOnHover(hrefs: readonly string[]): PrefetchHandlers {
  let triggered = false;
  const trigger = (): void => {
    if (triggered) return;
    triggered = true;
    hrefs.forEach((href) =>
      insertResourceHint({ href, as: 'document', rel: 'prefetch' }),
    );
  };
  return {
    onMouseEnter: trigger,
    onFocus: trigger,
    onTouchStart: trigger,
  };
}
