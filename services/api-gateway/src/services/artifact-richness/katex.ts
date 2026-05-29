/**
 * KaTeX math renderer — wave ARTIFACT-RICHNESS.
 *
 * Walks the markdown body for `$$...$$` (display math) and `$...$`
 * (inline math) and pre-renders each occurrence to HTML + MathML
 * via the lazy-imported `katex` package. When `katex` is not
 * available at runtime we fall back to the original `$...$`
 * source wrapped in `<code>` so the artifact never crashes.
 *
 * The pre-rendered HTML is opaque to the downstream markdown-to-html
 * pass — we substitute via the same opaque-marker mechanism the
 * mermaid renderer uses.
 *
 * Pattern recognition is intentionally conservative:
 *   - Display: `$$...$$` may span multiple lines.
 *   - Inline: `$...$` must not contain whitespace at the boundaries
 *     and must not be preceded by `\` (escaped dollar).
 *
 * This catches every formula the Borjie templates emit (royalty %,
 * recovery %, NPV, IRR, simple algebra) while ignoring runaway
 * dollar signs in narrative copy.
 */

import {
  makeMarker,
  makeMarkerId,
  type ArtifactLanguage,
} from './types.js';

const DISPLAY_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_RE = /(^|[^\\$])\$([^\s$][^$\n]*[^\s$])\$(?!\$)/g;

export interface KatexExtractResult {
  readonly body: string;
  readonly htmlOverrides: Readonly<Record<string, string>>;
  readonly count: number;
}

export async function renderMathBlocks(
  body: string,
  language: ArtifactLanguage = 'en',
): Promise<KatexExtractResult> {
  const htmlOverrides: Record<string, string> = {};
  let count = 0;

  // The `katex` package is an OPTIONAL peer dependency. When it is
  // installed it provides server-side rendering; when it is missing
  // we degrade gracefully. We import it via a string variable so the
  // bundler does not try to resolve it at build time on hosts that
  // do not ship the package.
  const katex: unknown = await loadKatex();

  let processed = body.replace(DISPLAY_RE, (_, latex: string) => {
    const id = makeMarkerId('math', count);
    const marker = makeMarker(id);
    htmlOverrides[marker] = renderOne(katex, latex, true, language);
    count += 1;
    return `\n\n${marker}\n\n`;
  });

  processed = processed.replace(INLINE_RE, (match: string, lead: string, latex: string) => {
    const id = makeMarkerId('math', count);
    const marker = makeMarker(id);
    htmlOverrides[marker] = renderOne(katex, latex, false, language);
    count += 1;
    return `${lead}${marker}`;
  });

  return Object.freeze({
    body: processed,
    htmlOverrides: Object.freeze(htmlOverrides),
    count,
  });
}

function renderOne(
  katex: unknown,
  source: string,
  displayMode: boolean,
  language: ArtifactLanguage,
): string {
  if (katex && typeof (katex as { renderToString?: unknown }).renderToString === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (katex as any).renderToString(source, {
        displayMode,
        throwOnError: false,
        output: 'htmlAndMathml',
        strict: false,
      });
      return typeof result === 'string' ? result : fallback(source, displayMode, language);
    } catch {
      return fallback(source, displayMode, language);
    }
  }
  return fallback(source, displayMode, language);
}

async function loadKatex(): Promise<unknown> {
  try {
    // Dynamic import via a string-typed identifier so the bundler /
    // typechecker does not require `@types/katex` or the runtime
    // package to be installed. Hosts that want server-side math
    // simply `pnpm add katex` and the lazy import resolves it.
    const moduleName: string = 'katex';
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = (await dynamicImport(moduleName)) as { default?: unknown } & Record<string, unknown>;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function fallback(source: string, displayMode: boolean, language: ArtifactLanguage): string {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const label = language === 'sw' ? 'fomula' : 'formula';
  if (displayMode) {
    return `<div class="borjie-math-fallback borjie-math-display" role="math" aria-label="${label}"><pre><code>${escaped}</code></pre></div>`;
  }
  return `<code class="borjie-math-fallback borjie-math-inline" role="math" aria-label="${label}">${escaped}</code>`;
}
