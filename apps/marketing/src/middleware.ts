import { NextResponse, type NextRequest } from 'next/server';

/**
 * Locale-prefixed marketing URL support (SEO-L3).
 *
 * Borjie marketing resolves locale from the `borjie_locale` cookie on a shared
 * URL, which makes the Swahili surface invisible to search + AI crawlers — they
 * send no cookie, so every page renders English to a bot. To give Swahili its
 * own indexable URLs WITHOUT restructuring every route, a
 * `/sw/<public-marketing-path>` request is REWRITTEN to `<public-marketing-path>`
 * with an `x-borjie-locale: sw` header the server components read
 * (`lib/locale.ts` reads this header BEFORE the cookie). The visible URL stays
 * `/sw/...` for the user and the crawler.
 *
 * SAFETY: this is a pure ADDITION. Only a `/sw/` page path that resolves to a
 * PUBLIC marketing route is rewritten; every existing (non-`/sw/`) request is
 * passed through untouched, and no `/sw/*` URL existed before this, so no
 * current traffic changes behavior. A `/sw/<unknown>` path falls through to the
 * normal 404 rather than leaking into a private surface.
 *
 * @module middleware
 */

/**
 * Request header carrying the locale of a `/sw/*` rewrite. MUST match
 * `LOCALE_HEADER` in `lib/locale.ts`.
 */
export const LOCALE_HEADER = 'x-borjie-locale';

/**
 * Static public marketing routes eligible for a `/sw` alternate. The `/for-*`
 * audience family is matched by prefix below (drift-safe: a NEW segment page is
 * covered without editing this list). Kept in sync with the sitemap by
 * `middleware-locale.test.ts`.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '',
  '/about',
  '/blog',
  '/buyers',
  '/careers',
  '/contact',
  '/docs',
  '/dpa',
  '/legal',
  '/pilot',
  '/pricing',
  '/privacy',
  '/status',
  '/support',
  '/terms',
];

/**
 * A public marketing route may render a `/sw` alternate. The `/for-*` audience
 * family and `/legal/*` sub-pages match by prefix; everything else must be an
 * exact enumerated route or a sub-path of one (e.g. `/blog/<slug>`).
 */
export function isPublicRoute(pathname: string): boolean {
  if (pathname === '/for' || pathname.startsWith('/for-')) return true;
  return PUBLIC_ROUTES.some(
    (route) =>
      route !== '' &&
      (pathname === route || pathname.startsWith(`${route}/`)),
  );
}

/**
 * Resolve a `/sw`-prefixed public marketing path to its stripped route.
 * Returns `null` for a non-`/sw` path or a `/sw/<non-public>` path so the
 * request falls through unchanged.
 */
export function resolveLocalePrefix(
  pathname: string,
): { locale: 'sw'; strippedPath: string } | null {
  if (pathname === '/sw' || pathname === '/sw/') {
    return { locale: 'sw', strippedPath: '/' };
  }
  if (pathname.startsWith('/sw/')) {
    const strippedPath = pathname.slice('/sw'.length); // keeps leading "/"
    if (isPublicRoute(strippedPath)) {
      return { locale: 'sw', strippedPath };
    }
  }
  return null;
}

export function middleware(request: NextRequest): NextResponse {
  const localePrefix = resolveLocalePrefix(request.nextUrl.pathname);
  if (localePrefix) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = localePrefix.strippedPath;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(LOCALE_HEADER, localePrefix.locale);
    return NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
  }
  return NextResponse.next();
}

/**
 * Only run the middleware on `/sw` paths — every other request is byte-identical
 * to before. Excludes static assets and the metadata routes so `/sw/sitemap.xml`
 * etc. never rewrite.
 */
export const config = {
  matcher: ['/sw', '/sw/:path*'],
};
