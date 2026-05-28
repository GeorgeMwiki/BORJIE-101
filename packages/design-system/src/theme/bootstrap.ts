/**
 * Inline-script string that reads `localStorage` for a saved theme and
 * applies the right class on `<html>` *before* React hydrates. Eliminates
 * the flash-of-wrong-theme (FOUT) when the SSR HTML and the hydrated
 * tree disagree.
 *
 * Embed in `<head>` via `<script dangerouslySetInnerHTML>` once per
 * Next.js root layout — never call this at runtime.
 */
export const BORJIE_THEME_BOOTSTRAP_SCRIPT = `
(function(){
  try {
    var k = 'borjie-theme';
    var stored = window.localStorage.getItem(k);
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var dark;
    if (stored === 'light') dark = false;
    else if (stored === 'dark') dark = true;
    else if (stored === 'system' || !stored) dark = media.matches;
    else dark = true;
    var root = document.documentElement;
    root.classList.remove('light','dark');
    root.classList.add(dark ? 'dark' : 'light');
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch(_) { /* best-effort, never block render */ }
})();
`;
