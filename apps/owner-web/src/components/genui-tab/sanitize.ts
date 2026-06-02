/**
 * Plain-text sanitiser for portal-genui tab content.
 *
 * A generated `PortalTab` is zod-validated server-side, but its string
 * fields (titles, labels, help, descriptions) still originate from an LLM.
 * Per CLAUDE.md — "No raw HTML interpolation. DOMPurify wraps required." —
 * every such string is run through DOMPurify with ALL tags + attributes
 * stripped before it reaches the DOM, so even a label that somehow carried
 * markup can never inject. React already escapes text children; this is the
 * mandated defence-in-depth layer.
 */

import DOMPurify from 'dompurify';

/**
 * Strip every tag/attribute, returning safe plain text. SSR has no DOM, so
 * we fall back to a conservative manual angle-bracket strip there; the client
 * re-sanitises after mount (same SSR contract as ArtifactRenderer).
 */
export function toSafeText(value: string | null | undefined): string {
  if (!value) return '';
  if (typeof window === 'undefined') {
    // No DOM on the server — strip angle-bracket tags to fixpoint so that
    // nested constructs like `<<script>` cannot survive a single pass
    // (js/incomplete-multi-character-sanitization defense-in-depth).
    // The client re-sanitises with DOMPurify after hydration; this SSR path
    // is the belt-and-suspenders layer only.
    let prev = value;
    let next = prev.replace(/<[^>]*>/g, '');
    while (next !== prev) {
      prev = next;
      next = prev.replace(/<[^>]*>/g, '');
    }
    return next;
  }
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
}
