/**
 * SVG sanitiser for generative-UI `dynamic_visual` blocks.
 *
 * A `dynamic_visual` block's `svg` string is composed by the model from the
 * SVG-primitives prompt (`svg-primitives.ts`) — it is LLM-adjacent and so
 * MUST be treated as untrusted. Per CLAUDE.md — "No raw HTML interpolation.
 * DOMPurify wraps required." — every such string is run through DOMPurify
 * (SVG profile) before it reaches `dangerouslySetInnerHTML`, stripping
 * `<script>`, `onload=`/event handlers, `<foreignObject>` script vectors,
 * `javascript:` hrefs, etc., while preserving legitimate SVG shapes/text.
 *
 * Mirrors `apps/owner-web/src/components/genui-tab/sanitize.ts`: DOMPurify
 * needs a DOM, so on the server (no `window`) we return '' and let the
 * client re-sanitise after mount — the same SSR contract the ArtifactRenderer
 * already uses for injected markup.
 */

import DOMPurify from 'dompurify';

/**
 * Sanitise an LLM-composed SVG string into a safe SVG fragment.
 *
 * @returns the DOMPurify-sanitised SVG on the client; '' on the server
 *          (no DOM — the client re-sanitises post-hydration).
 */
export function toSafeSvg(value: string | null | undefined): string {
  if (!value) return '';
  // No DOM on the server: never emit raw SVG markup server-side; the client
  // re-renders this block through DOMPurify after hydration (defence-in-depth,
  // matching the genui sanitize.ts / ArtifactRenderer SSR contract).
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
