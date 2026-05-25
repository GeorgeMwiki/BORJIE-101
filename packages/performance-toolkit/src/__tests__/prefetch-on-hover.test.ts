import { describe, expect, it, beforeEach } from 'vitest';
import {
  insertResourceHint,
  prefetchOnHover,
  prefetchManyOnHover,
} from '../lazy-load/prefetch-on-hover.js';

interface FakeLink {
  rel: string;
  href: string;
  crossOrigin?: string;
  attrs: Map<string, string>;
}

function setupDom(): FakeLink[] {
  const links: FakeLink[] = [];
  const head = {
    appendChild(node: FakeLink) {
      links.push(node);
      return node;
    },
  };
  (globalThis as unknown as { document?: unknown }).document = {
    head,
    createElement() {
      const link: FakeLink = {
        rel: '',
        href: '',
        attrs: new Map<string, string>(),
        setAttribute(k: string, v: string) {
          this.attrs.set(k, v);
        },
      } as unknown as FakeLink;
      return link;
    },
    querySelector(selector: string) {
      // Trivial selector matcher: link[rel="X"][href="Y"]
      const relMatch = /link\[rel="([^"]+)"\]\[href="([^"]+)"\]/.exec(selector);
      if (relMatch === null) return null;
      const [, rel, href] = relMatch;
      return links.find((l) => l.rel === rel && l.href === href) ?? null;
    },
  };
  return links;
}

describe('insertResourceHint', () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = undefined;
  });

  it('appends a <link rel="prefetch"> element', () => {
    const links = setupDom();
    insertResourceHint({ href: '/dashboard', as: 'document' });
    expect(links).toHaveLength(1);
    expect(links[0]!.rel).toBe('prefetch');
    expect(links[0]!.href).toBe('/dashboard');
  });

  it('is idempotent — duplicate inserts skip', () => {
    const links = setupDom();
    insertResourceHint({ href: '/dashboard' });
    insertResourceHint({ href: '/dashboard' });
    insertResourceHint({ href: '/dashboard' });
    expect(links).toHaveLength(1);
  });

  it('respects preload rel', () => {
    const links = setupDom();
    insertResourceHint({ href: '/font.woff2', rel: 'preload', as: 'font', crossOrigin: 'anonymous' });
    expect(links[0]!.rel).toBe('preload');
    expect(links[0]!.crossOrigin).toBe('anonymous');
  });

  it('is a no-op when document is undefined (SSR)', () => {
    insertResourceHint({ href: '/dashboard' }); // Must not throw
  });
});

describe('prefetchOnHover', () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = undefined;
  });

  it('returns the expected handler shape', () => {
    const h = prefetchOnHover('/x');
    expect(typeof h.onMouseEnter).toBe('function');
    expect(typeof h.onFocus).toBe('function');
    expect(typeof h.onTouchStart).toBe('function');
  });

  it('inserts only ONE link even when multiple events fire', () => {
    const links = setupDom();
    const h = prefetchOnHover('/properties');
    h.onMouseEnter();
    h.onFocus();
    h.onTouchStart();
    h.onMouseEnter();
    expect(links).toHaveLength(1);
    expect(links[0]!.href).toBe('/properties');
  });

  it('uses preload + as=script when caller requests script', () => {
    const links = setupDom();
    const h = prefetchOnHover('/chunks/dashboard.js', { rel: 'modulepreload', as: 'script' });
    h.onMouseEnter();
    expect(links[0]!.rel).toBe('modulepreload');
    expect(links[0]!.attrs.get('as')).toBe('script');
  });
});

describe('prefetchManyOnHover', () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = undefined;
  });

  it('inserts one link per href on first interaction', () => {
    const links = setupDom();
    const h = prefetchManyOnHover(['/a', '/b', '/c']);
    h.onMouseEnter();
    expect(links).toHaveLength(3);
    h.onMouseEnter();
    expect(links).toHaveLength(3); // still 3 — second call is no-op
  });
});
