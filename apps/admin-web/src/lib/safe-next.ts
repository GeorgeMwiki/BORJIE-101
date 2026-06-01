/**
 * `sanitizeNext` — open-redirect guard for the `?next=` deep-link param.
 *
 * A `next` target is only safe to navigate to when it is a *same-origin*
 * absolute path. A naive `next.startsWith('/')` check is NOT enough: a
 * protocol-relative URL (`//evil.com`) and the backslash variants browsers
 * normalise to `//` (`/\evil.com`, `\\evil.com`, `/%5Cevil.com`) all begin
 * with `/` yet send the user to a foreign origin. This rejects every such
 * variant and falls back to the app root.
 *
 * Returns a guaranteed-local path (`'/'` when the input is unsafe/empty).
 */
export function sanitizeNext(next: string | null | undefined): string {
  if (!next) {
    return '/';
  }
  const trimmed = next.trim();
  // Must be a root-relative path …
  if (!trimmed.startsWith('/')) {
    return '/';
  }
  // … but not a protocol-relative (`//host`) or backslash-smuggled
  // (`/\host`, `/%5Chost`) authority that browsers treat as cross-origin.
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.startsWith('/%5C') ||
    trimmed.startsWith('/%5c')
  ) {
    return '/';
  }
  return trimmed;
}
