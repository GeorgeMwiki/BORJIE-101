import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static-source regression guard for the Mode-C marketing fixes:
 *  - every server-rendered native `<form action="/api/...">` has a
 *    matching Next route handler (no native-POST 404 / lost message);
 *  - no dead in-page anchors (`/#brief`, `/pilot#contact`) survive;
 *  - the 404 page stays single-locale (no Swahili clause glued to
 *    English — the single-language-per-locale rule is ABSOLUTE);
 *  - the live-status board never silently same-origins its fetch.
 *
 * Reads files as text so it needs no React renderer or DOM — it just
 * asserts the wiring the review demanded actually shipped.
 */
const SRC = join(__dirname, '..');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

describe('marketing form-action routes resolve (no native-POST 404)', () => {
  it('every <form action="/api/.."> has a matching route.ts', () => {
    const pages = [
      'app/contact/page.tsx',
      'app/blog/page.tsx',
      'app/pilot/page.tsx',
    ];
    const actions = new Set<string>();
    for (const p of pages) {
      const re = /action="(\/api\/[a-z0-9/-]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(read(p))) !== null) {
        if (m[1]) actions.add(m[1]);
      }
    }
    for (const action of actions) {
      const routeFile = join(SRC, 'app', action.replace(/^\//, ''), 'route.ts');
      expect(existsSync(routeFile), `${action} → ${routeFile}`).toBe(true);
    }
  });

  it('ships the contact + subscribe route handlers', () => {
    expect(existsSync(join(SRC, 'app/api/contact/route.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'app/api/subscribe/route.ts'))).toBe(true);
  });
});

describe('no dead in-page anchors', () => {
  const files = [
    'components/Hero.tsx',
    'components/Footer.tsx',
    'components/sections/RoadmapCTASection.tsx',
  ];
  it('does not reference the removed /#brief anchor', () => {
    for (const f of files) expect(read(f)).not.toContain('/#brief');
  });
  it('does not reference the removed /pilot#contact anchor', () => {
    for (const f of files) expect(read(f)).not.toContain('/pilot#contact');
  });
  it('the #product anchor target still exists on the home grid', () => {
    expect(read('components/CapabilitiesGrid.tsx')).toContain('id="product"');
  });
});

describe('404 page is single-locale (en default)', () => {
  it('has no Swahili "Ukurasa" clause glued to English copy', () => {
    expect(read('app/not-found.tsx')).not.toContain('Ukurasa');
  });
});

describe('status board fails loud instead of same-origining', () => {
  it('does not silently return an empty base url', () => {
    const src = read('components/StatusBoard.tsx');
    expect(src).toContain('requirePublicBaseUrl');
    expect(src).not.toMatch(/return\s*'';/);
  });
});

describe('KI-016 — audience pages are reachable (no orphan landing pages)', () => {
  const nav = read('components/Nav.tsx');
  // The 3 previously-orphaned (built-but-unlinked) audience pages.
  const NEWLY_LINKED = ['/for-csr-community', '/for-bank', '/for-family-office'];

  it('each newly-linked audience page appears in the "Who we serve" Nav', () => {
    for (const href of NEWLY_LINKED) {
      expect(nav, `${href} should be a Nav audience href`).toContain(
        `href: '${href}'`,
      );
    }
  });

  it('each newly-linked audience page appears in the sitemap', () => {
    const sitemap = read('app/sitemap.ts');
    for (const href of NEWLY_LINKED) {
      // The sitemap may store paths inside template literals, as plain
      // strings via the `entry('/path', …)` helper, or as a leading-slash-less
      // slug in the SEGMENT_SLUGS list (mapped to `/${slug}`) — accept any form
      // so future structural refactors don't trip this canary. The
      // filesystem-vs-slugs equality is enforced separately by
      // app/__tests__/sitemap-coverage.test.ts.
      const slug = href.replace(/^\//, '');
      const inTemplate = sitemap.includes(`${href}\``);
      const inEntry = sitemap.includes(`'${href}'`);
      const inSlugList = sitemap.includes(`'${slug}'`);
      expect(
        inTemplate || inEntry || inSlugList,
        `${href} should be in sitemap (template, entry, or slug-list form)`,
      ).toBe(true);
    }
  });

  it('every Nav audience href resolves to a real page.tsx (no dead links)', () => {
    const re = /href:\s*'(\/(?:for-[a-z-]+|buyers))'/g;
    const hrefs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(nav)) !== null) {
      if (m[1]) hrefs.add(m[1]);
    }
    // Guard against the regex silently matching nothing.
    expect(hrefs.size).toBeGreaterThanOrEqual(NEWLY_LINKED.length);
    for (const href of hrefs) {
      const pageFile = join(SRC, 'app', href.replace(/^\//, ''), 'page.tsx');
      expect(existsSync(pageFile), `${href} → ${pageFile}`).toBe(true);
    }
  });

  it('the /for-buyer duplicate of /buyers was deleted', () => {
    expect(existsSync(join(SRC, 'app/for-buyer/page.tsx'))).toBe(false);
    // ...and nothing links to the removed route.
    expect(nav).not.toContain("'/for-buyer'");
    const sitemap = read('app/sitemap.ts');
    // Neither the template-literal form nor the entry-helper string form.
    expect(sitemap).not.toContain('/for-buyer`');
    expect(sitemap).not.toContain("'/for-buyer'");
  });
});

describe('StatusBoard timestamp threads the active locale (no host-default leak)', () => {
  const src = read('components/StatusBoard.tsx');

  it('never renders a bare host-default toLocaleString() on the bilingual surface', () => {
    // A bare `.toLocaleString()` call with no BCP-47 argument formats the
    // timestamp with the VISITOR host default — an English-by-omission
    // render under the `sw` surface (zero-mix canon violation). Strip
    // comments first so the doc-block reference does not false-positive;
    // only an actual method call `).toLocaleString()` is the offender.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\)\.toLocaleString\(\s*\)/);
  });

  it('passes the resolved BCP-47 tag into the timestamp render', () => {
    expect(src).toContain('toLocaleString(props.bcp47)');
  });

  it('maps both launch locales to Tanzania-region tags (mirrors genui/format)', () => {
    expect(src).toContain("en: 'en-TZ'");
    expect(src).toContain("sw: 'sw-TZ'");
  });
});
