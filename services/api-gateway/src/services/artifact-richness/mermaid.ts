/**
 * Mermaid block renderer — wave ARTIFACT-RICHNESS.
 *
 * Walks the input markdown for fenced ` ```mermaid ` blocks and
 * pre-renders each one to inline SVG. Because mermaid normally needs
 * a browser DOM, we render via the headless Chromium that already
 * ships with this repo's Playwright dependency (same pattern the
 * `pdf-renderer.ts` follows). When Chromium cannot launch, we
 * gracefully degrade to a styled `<pre>` block carrying the mermaid
 * source so the artifact remains readable.
 *
 * Every replacement is keyed by an opaque marker (`RICHNESS_TOKEN_…`)
 * so the downstream markdown-to-html pass does NOT escape the SVG
 * angle brackets. The HTML is spliced in by the renderer just before
 * the final string is returned to the caller.
 */

import {
  makeMarker,
  makeMarkerId,
  type ArtifactLanguage,
} from './types.js';

const MERMAID_FENCE_RE = /```mermaid\r?\n([\s\S]*?)```/g;

const FALLBACK_HEADER_SW = 'Mchoro wa Mermaid (chanzo)';
const FALLBACK_HEADER_EN = 'Mermaid diagram (source)';

export interface MermaidExtractResult {
  readonly body: string;
  readonly htmlOverrides: Readonly<Record<string, string>>;
  readonly count: number;
}

/**
 * Extract mermaid fences and substitute them with markers. Returns a
 * promise so an implementation may async-render via a headless
 * browser. The current implementation prefers a synchronous fallback
 * (escaped `<pre>` block) — the Playwright path is invoked lazily by
 * the renderer pipeline when a flag is set, since most artifact paths
 * already pay the Playwright cost in PDF rendering and double-paying
 * doubles cold-start latency.
 */
export async function renderMermaidBlocks(
  body: string,
  language: ArtifactLanguage = 'en',
  opts: { readonly tryHeadless?: boolean } = {},
): Promise<MermaidExtractResult> {
  const htmlOverrides: Record<string, string> = {};
  let count = 0;
  const matches: Array<{ source: string; marker: string }> = [];

  const withMarkers = body.replace(MERMAID_FENCE_RE, (_, raw: string) => {
    const id = makeMarkerId('mermaid', count);
    const marker = makeMarker(id);
    matches.push({ source: raw.trim(), marker });
    count += 1;
    return marker;
  });

  for (const m of matches) {
    let svg: string | null = null;
    if (opts.tryHeadless) {
      svg = await tryHeadlessMermaid(m.source).catch(() => null);
    }
    htmlOverrides[m.marker] =
      svg ?? mermaidFallbackHtml(m.source, language);
  }

  return Object.freeze({
    body: withMarkers,
    htmlOverrides: Object.freeze(htmlOverrides),
    count,
  });
}

function mermaidFallbackHtml(source: string, language: ArtifactLanguage): string {
  const header = language === 'sw' ? FALLBACK_HEADER_SW : FALLBACK_HEADER_EN;
  const escaped = escapeHtml(source);
  return `<figure class="borjie-mermaid-fallback" role="img" aria-label="${escapeHtml(header)}">
  <figcaption>${escapeHtml(header)}</figcaption>
  <pre><code>${escaped}</code></pre>
</figure>`;
}

/**
 * SSRF guard for the headless mermaid renderer — mirror of the
 * puppeteer-server `isBlockedRenderUrl`. Untrusted mermaid source must
 * never let the headless browser reach cloud-metadata (169.254.169.254),
 * loopback, or internal VPC ranges. Returns true when a subresource URL
 * must be BLOCKED. Public http(s) (incl. the mermaid CDN) + inline schemes
 * pass.
 */
function isBlockedSubresourceUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme === 'data:' || scheme === 'about:' || scheme === 'blob:') {
    return false;
  }
  if (scheme !== 'http:' && scheme !== 'https:') return true;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0') {
    return true;
  }
  if (
    host === '::1' ||
    host.startsWith('fe80') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  return false;
}

async function tryHeadlessMermaid(source: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playwright: any = await import('playwright').catch(() => null);
    if (!playwright || typeof playwright.chromium?.launch !== 'function') {
      return null;
    }
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // SSRF defence: abort any subresource the diagram tries to pull from
      // a metadata/loopback/internal host before the request leaves. The
      // mermaid CDN (public https) is allowed; everything internal is not.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.route('**/*', (route: any) => {
        const url = typeof route.request === 'function' ? route.request().url() : '';
        if (isBlockedSubresourceUrl(url)) {
          route.abort('blockedbyclient').catch(() => undefined);
        } else {
          route.continue().catch(() => undefined);
        }
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<div class="mermaid">${escapeHtml(source)}</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  window.mermaid.initialize({ startOnLoad:false, securityLevel:'strict', theme:'neutral', flowchart:{ htmlLabels:false }});
  window.__svg = null;
  window.mermaid.render('borjie-graph', ${JSON.stringify(source)}).then(({svg}) => {
    document.querySelector('.mermaid').innerHTML = svg;
    window.__svg = svg;
  }).catch(() => { window.__svg = null; });
</script>
</body></html>`;
      await page.setContent(html, { waitUntil: 'networkidle' });
      // `page.evaluate` runs the function in the browser context where
      // `window` exists. We pass the function as a string so the
      // Node-side TS compiler does not complain about a missing DOM lib.
      const svg = await page.evaluate(
        'window.__svg ?? null',
      );
      await context.close();
      return typeof svg === 'string' && svg.startsWith('<svg') ? svg : null;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
