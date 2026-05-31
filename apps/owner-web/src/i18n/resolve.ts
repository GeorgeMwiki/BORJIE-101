/**
 * Pure dictionary resolver — the single key→string algorithm shared by
 * the server resolver (t.server.ts) and the client hook (t.client.ts).
 *
 * Mirrors `@borjie/i18n`'s `serverT` semantics intentionally so the
 * whole monorepo resolves i18n keys the same way: dot-notation lookup,
 * `{var}` interpolation, and a MISSING key returns "" (never a mixed or
 * synthetic fallback). A blank render makes a translation gap obvious to
 * QA and to the locale-purity guard instead of silently leaking the
 * other language.
 *
 * Hook-free and dependency-free so it is safe to import from both the
 * server bundle (next/headers context) and the client bundle.
 */

export type Vars = Readonly<Record<string, string | number>>;

/** Look up a dot-notation key in a nested dictionary tree. */
export function resolveKey(tree: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let current: unknown = tree;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : '';
}

/** Replace `{name}` tokens with the matching var; leaves unknown tokens intact. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

/** Bound translator signature returned by getServerT()/useT(). */
export type TFn = (key: string, vars?: Vars) => string;

/** Build a bound translator over a single locale's resolved tree. */
export function makeT(tree: Record<string, unknown>): TFn {
  return (key, vars) => interpolate(resolveKey(tree, key), vars);
}
