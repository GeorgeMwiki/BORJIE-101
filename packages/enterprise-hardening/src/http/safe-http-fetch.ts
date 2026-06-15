/**
 * Central safe HTTP fetch — SSRF allowlist + internal-IP denylist.
 *
 * Phase D agent D9 — A3/A5 Tier-1 closure for outbound HTTP egress.
 *
 * Every outbound HTTP call from BORJIE services (webhook delivery,
 * tax-authority lookups, AI provider calls, document-retrieval fetches)
 * MUST route through `safeHttpFetch`. The function:
 *
 *   1. Resolves the URL to a host and rejects any host that resolves
 *      (or is) inside the loopback / link-local / private RFC1918 /
 *      RFC6598 carrier-grade-NAT / IPv6-equivalents ranges.
 *   2. PINS the screened resolution for the actual dispatch. The host is
 *      resolved ONCE; the safe address set it produced is then handed to
 *      a custom undici `Agent` whose `connect.lookup` returns ONLY those
 *      pre-screened addresses — so the kernel connects to the exact IP we
 *      screened, never a second (possibly rebound) resolution. The Host
 *      header + TLS SNI servername stay the original hostname, so vhosts
 *      and certificate validation still work. This closes the screen-then-
 *      fetch DNS-rebinding TOCTOU window: a poisoned second resolution can
 *      never land because there is no second resolution.
 *   3. Optionally accepts an explicit allowlist of outbound destinations.
 *      When `allowlist` is non-empty, ONLY those destinations may be
 *      reached. Used for high-risk surfaces (e.g. webhook delivery to
 *      operator-supplied URLs).
 *   4. Always sets a hard 10 s default timeout via AbortController.
 *
 * The function never mutates its inputs. Errors are typed as
 * `SafeHttpFetchError` with a `code` discriminator so callers can react
 * without parsing strings.
 *
 * SOC 2 CC6.6 (Boundary protection): every egress call is recorded in the
 * caller-side audit log; this module merely enforces the boundary.
 */

import { promises as dnsP, type LookupAddress } from 'node:dns';
import { Agent, type Dispatcher } from 'undici';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SafeHttpFetchErrorCode =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'denied-internal-ip'
  | 'denied-not-in-allowlist'
  | 'denied-port'
  | 'timeout'
  | 'network-error';

export class SafeHttpFetchError extends Error {
  readonly code: SafeHttpFetchErrorCode;
  readonly destination: string;
  constructor(code: SafeHttpFetchErrorCode, destination: string, detail: string) {
    super(`safeHttpFetch[${code}] ${destination}: ${detail}`);
    this.name = 'SafeHttpFetchError';
    this.code = code;
    this.destination = destination;
  }
}

export interface SafeHttpFetchOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly timeoutMs?: number;
  /**
   * Allowlist of `host` substrings (case-insensitive). When non-empty, the
   * destination host MUST contain at least one entry. Recommend passing
   * fully-qualified hostnames (e.g. "api.stripe.com") rather than bare TLDs.
   */
  readonly allowlist?: ReadonlyArray<string>;
  /** Allowed ports — defaults to [80, 443]. */
  readonly allowedPorts?: ReadonlyArray<number>;
  /** Allowed schemes — defaults to ['http:', 'https:']. */
  readonly allowedSchemes?: ReadonlyArray<string>;
  /**
   * Injectable fetch (defaults to global `fetch`). Lets tests assert what
   * was called without spinning up a real network listener.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Injectable DNS lookup (defaults to `node:dns/promises#lookup`). The
   * single resolution this returns is BOTH screened AND pinned for the
   * dispatch (its safe addresses are fed to the connect-time lookup), so a
   * poisoned second resolution can never sneak the request to an internal
   * IP — there is no second resolution. Lets tests drive DNS-rebinding
   * scenarios deterministically.
   */
  readonly dnsLookup?: (
    host: string,
  ) => Promise<ReadonlyArray<LookupAddress>>;
}

export interface SafeHttpFetchResult {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Internal-IP detection
// ---------------------------------------------------------------------------

const PRIVATE_IPV4_PATTERNS: ReadonlyArray<RegExp> = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  // RFC6598 carrier-grade NAT.
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // Cloud metadata service.
  /^169\.254\.169\.254$/,
  // Broadcast and multicast.
  /^(?:0|255)\./,
  /^(?:22[4-9]|23\d)\./,
];

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

function isInternalIPv4(host: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((re) => re.test(host));
}

function isInternalIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1') return true;
  if (h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
  if (h.startsWith('fe80:')) return true; // link-local
  // IPv4-mapped IPv6 — resolve to inner v4.
  const v4mapped = h.match(/^::ffff:([0-9.]+)$/);
  if (v4mapped && isInternalIPv4(v4mapped[1])) return true;
  return false;
}

function isInternalHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.local')) return true;
  if (lower.endsWith('.internal')) return true;
  if (lower.endsWith('.localhost')) return true;
  if (lower.includes(':')) return isInternalIPv6(lower);
  if (/^[\d.]+$/.test(lower)) return isInternalIPv4(lower);
  return false;
}

/**
 * Resolve `host` via DNS and return the first internal IP (if any) plus
 * the full address set. Closes the SSRF gap where a hostname whose
 * A-record points to RFC1918 / link-local addresses would bypass the
 * string-only check.
 *
 * For literal IPs we skip the DNS round-trip — `isInternalHost` has
 * already screened them.
 */
async function resolveAndScreen(
  host: string,
  lookup: (host: string) => Promise<ReadonlyArray<LookupAddress>>,
): Promise<{
  readonly internalHit: LookupAddress | null;
  readonly all: ReadonlyArray<LookupAddress>;
}> {
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return { internalHit: null, all: [] };
  }
  let addresses: ReadonlyArray<LookupAddress>;
  try {
    addresses = await lookup(host);
  } catch {
    return { internalHit: null, all: [] };
  }
  for (const a of addresses) {
    const isInternal =
      a.family === 6 ? isInternalIPv6(a.address) : isInternalIPv4(a.address);
    if (isInternal) {
      return { internalHit: a, all: addresses };
    }
  }
  return { internalHit: null, all: addresses };
}

const defaultDnsLookup = async (
  host: string,
): Promise<ReadonlyArray<LookupAddress>> => dnsP.lookup(host, { all: true });

// ---------------------------------------------------------------------------
// IP-pinning — the screen-then-fetch TOCTOU closure
// ---------------------------------------------------------------------------

/**
 * The shape `undici`'s `connect.lookup` callback expects. We re-declare it
 * narrowly so this module does not pull a `@types/node` `dns` callback type
 * the package's `types: ["node"]` may shape differently across versions.
 */
type ConnectLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

/**
 * Build the connect-time `lookup` undici will call in place of the kernel
 * resolver. It returns ONLY the first pre-screened address, so the socket
 * dials EXACTLY what we screened — a rebind between screen and connect has
 * no second resolution to poison.
 *
 * Belt-and-braces: the pinned address is re-screened here, so even a caller
 * that hands in a poisoned `pinned` set cannot reach an internal range.
 * Pure + exported for direct unit testing (no undici internals, no socket).
 */
export function pinnedConnectLookup(
  pinned: ReadonlyArray<LookupAddress>,
): (
  hostname: string,
  options: unknown,
  callback: ConnectLookupCallback,
) => void {
  const primary = pinned.find((a) =>
    a.family === 6 ? !isInternalIPv6(a.address) : !isInternalIPv4(a.address),
  );
  return (_hostname, _options, callback): void => {
    if (!primary) {
      callback(
        Object.assign(new Error('no safe pinned address'), {
          code: 'ENOTFOUND',
        }) as NodeJS.ErrnoException,
        '',
        4,
      );
      return;
    }
    callback(null, primary.address, primary.family);
  };
}

/**
 * Build an undici `Agent` that pins ALL outbound connects to the exact
 * pre-screened address set, ignoring whatever a fresh kernel resolution
 * would return. The original Host header + TLS SNI servername are preserved
 * because we never rewrite the URL — only the L3 address the socket dials.
 */
function pinnedDispatcher(
  pinned: ReadonlyArray<LookupAddress>,
): Dispatcher {
  return new Agent({
    // A fresh Agent is created per request; drop idle sockets fast so an
    // un-closed dispatcher cannot pool connections indefinitely.
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 1,
    connect: {
      lookup: pinnedConnectLookup(pinned),
    },
  });
}

/**
 * Tear down a per-request pinned dispatcher (best-effort, never throws).
 * `close` drains in-flight requests; `destroy` aborts immediately on error.
 */
function shutdownDispatcher(
  dispatcher: Dispatcher | undefined,
  mode: 'close' | 'destroy',
): void {
  if (!dispatcher) return;
  const fn = dispatcher[mode] as (() => Promise<void>) | undefined;
  if (typeof fn !== 'function') return;
  const swallow = (): void => undefined;
  try {
    const p: Promise<void> | undefined = fn.call(dispatcher);
    if (p && typeof p.then === 'function') {
      p.then(swallow, swallow);
    }
  } catch {
    // Best-effort teardown — a failure here must never mask the response.
  }
}

// ---------------------------------------------------------------------------
// Allowlist matching
// ---------------------------------------------------------------------------

function matchesAllowlist(host: string, allowlist: ReadonlyArray<string>): boolean {
  if (allowlist.length === 0) return true;
  const lower = host.toLowerCase();
  return allowlist.some((entry) => {
    const e = entry.toLowerCase();
    // Allow exact match, suffix match (".example.com"), or substring within host (".vendor.")
    if (e.startsWith('.')) {
      return lower.endsWith(e) || lower === e.slice(1);
    }
    return lower === e || lower.endsWith(`.${e}`);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ALLOWED_PORTS: ReadonlyArray<number> = Object.freeze([80, 443]);
const DEFAULT_ALLOWED_SCHEMES: ReadonlyArray<string> = Object.freeze(['http:', 'https:']);

export async function safeHttpFetch(
  url: string,
  options: SafeHttpFetchOptions = {},
): Promise<SafeHttpFetchResult> {
  // 1) Parse + scheme check.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeHttpFetchError('invalid-url', url, 'URL parse failed');
  }
  const allowedSchemes = options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new SafeHttpFetchError(
      'unsupported-scheme',
      url,
      `scheme "${parsed.protocol}" not in [${allowedSchemes.join(', ')}]`,
    );
  }
  // 2) Port check.
  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const port =
    parsed.port !== ''
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
  if (!allowedPorts.includes(port)) {
    throw new SafeHttpFetchError(
      'denied-port',
      url,
      `port ${port} not in [${allowedPorts.join(', ')}]`,
    );
  }
  // 3) Internal-IP / hostname denylist (string-only short-circuit).
  // Hostname can include zone (e.g. fe80::1%eth0); strip brackets for v6.
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isInternalHost(rawHost)) {
    throw new SafeHttpFetchError(
      'denied-internal-ip',
      url,
      `host "${rawHost}" resolves to an internal / reserved range`,
    );
  }
  // 3b) DNS-resolved IP screening — closes the gap where a hostname
  // has an A-record pointing to a private range (e.g. `localtest.me`
  // → 127.0.0.1) that the string-only check can't see.
  const lookup = options.dnsLookup ?? defaultDnsLookup;
  const { internalHit, all: screenedAddresses } = await resolveAndScreen(
    rawHost,
    lookup,
  );
  if (internalHit) {
    throw new SafeHttpFetchError(
      'denied-internal-ip',
      url,
      `host "${rawHost}" resolved to internal IP ${internalHit.address}`,
    );
  }
  // 4) Allowlist (when present).
  const allowlist = options.allowlist ?? [];
  if (!matchesAllowlist(rawHost, allowlist)) {
    throw new SafeHttpFetchError(
      'denied-not-in-allowlist',
      url,
      `host "${rawHost}" not in allowlist`,
    );
  }
  // 5) Timeout + PINNED dispatch.
  //
  // Pin the screened resolution: hand the safe address set to an undici
  // Agent whose connect.lookup returns ONLY those IPs, so the socket dials
  // the exact address we screened (no second, rebindable resolution). When
  // `screenedAddresses` is empty the host was a literal IP already screened
  // by the string gate, so no dispatcher pin is needed (and a caller's
  // custom `fetchImpl` may not accept a `dispatcher` anyway).
  const fetchImpl = options.fetchImpl ?? fetch;
  const usingDefaultFetch = fetchImpl === fetch;
  const dispatcher =
    usingDefaultFetch && screenedAddresses.length > 0
      ? pinnedDispatcher(screenedAddresses)
      : undefined;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Build the init loosely: `dispatcher` is a Node/undici-only fetch field
  // (not in the DOM lib) and `BodyInit` is a DOM type this package's
  // `types: ["node"]` config doesn't load. Cast through `unknown` so both
  // the DOM-typed and node-typed `fetch` shapes compile, only attaching the
  // pinned dispatcher when we own the dispatch (default fetch).
  const init: Record<string, unknown> = {
    method: options.method ?? 'GET',
    headers: options.headers as Record<string, string> | undefined,
    body: options.body,
    signal: controller.signal,
  };
  if (dispatcher) init.dispatcher = dispatcher;
  try {
    const res = await fetchImpl(
      url,
      init as unknown as Parameters<typeof fetchImpl>[1],
    );
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    // Close the per-request pinned dispatcher once the body is consumed so
    // its pooled socket is reclaimed (keep-alive is already clamped to 1ms).
    const closePinned = (): void => shutdownDispatcher(dispatcher, 'close');
    return {
      status: res.status,
      ok: res.ok,
      headers,
      text: async (): Promise<string> => {
        try {
          return await res.text();
        } finally {
          closePinned();
        }
      },
      json: async (): Promise<unknown> => {
        try {
          return await res.json();
        } finally {
          closePinned();
        }
      },
    };
  } catch (err) {
    // Tear down the pinned dispatcher on any dispatch failure.
    shutdownDispatcher(dispatcher, 'destroy');
    if (err instanceof SafeHttpFetchError) throw err;
    const isAbort =
      (err as { name?: string })?.name === 'AbortError' ||
      controller.signal.aborted;
    if (isAbort) {
      throw new SafeHttpFetchError('timeout', url, `aborted after ${timeoutMs}ms`);
    }
    throw new SafeHttpFetchError(
      'network-error',
      url,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Pure URL-safety assertion — usable from any caller that wants the
// `safeHttpFetch` policy without committing to its fetch shape (e.g.
// webhook-delivery, which has its own injectable fetch port).
// ---------------------------------------------------------------------------

export interface AssertUrlSafeOptions {
  readonly allowlist?: ReadonlyArray<string>;
  readonly allowedPorts?: ReadonlyArray<number>;
  readonly allowedSchemes?: ReadonlyArray<string>;
  readonly dnsLookup?: (
    host: string,
  ) => Promise<ReadonlyArray<LookupAddress>>;
}

/**
 * The screened result returned by `assertUrlSafe` so callers that own
 * their own fetch can PIN the dispatch to the exact address set we
 * screened (closing the screen-then-fetch DNS-rebinding TOCTOU). For a
 * literal-IP host `addresses` is empty — the host is already pinned.
 */
export interface UrlSafetyResult {
  readonly host: string;
  readonly addresses: ReadonlyArray<LookupAddress>;
}

/**
 * Verify that `url` is safe to dispatch — scheme, port, internal-host
 * string-gate, DNS-resolved IP gate, and (optional) allowlist. Throws
 * `SafeHttpFetchError` on the first failure. Used by `safeHttpFetch`
 * itself; also exported so peers like the webhook-delivery dispatcher
 * can apply the exact same policy without depending on the fetch port.
 *
 * Returns the screened host + its safe resolved address set so a caller
 * can pin the dispatch via `pinnedSafeDispatcher(result)` (or pass the
 * whole url to it). Re-screen+pin per attempt inside any retry loop so a
 * rebind between attempts is also caught.
 */
export async function assertUrlSafe(
  url: string,
  options: AssertUrlSafeOptions = {},
): Promise<UrlSafetyResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeHttpFetchError('invalid-url', url, 'URL parse failed');
  }
  const allowedSchemes = options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new SafeHttpFetchError(
      'unsupported-scheme',
      url,
      `scheme "${parsed.protocol}" not in [${allowedSchemes.join(', ')}]`,
    );
  }
  const allowedPorts = options.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const port =
    parsed.port !== ''
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
  if (!allowedPorts.includes(port)) {
    throw new SafeHttpFetchError(
      'denied-port',
      url,
      `port ${port} not in [${allowedPorts.join(', ')}]`,
    );
  }
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isInternalHost(rawHost)) {
    throw new SafeHttpFetchError(
      'denied-internal-ip',
      url,
      `host "${rawHost}" resolves to an internal / reserved range`,
    );
  }
  const lookup = options.dnsLookup ?? defaultDnsLookup;
  const { internalHit, all } = await resolveAndScreen(rawHost, lookup);
  if (internalHit) {
    throw new SafeHttpFetchError(
      'denied-internal-ip',
      url,
      `host "${rawHost}" resolved to internal IP ${internalHit.address}`,
    );
  }
  const allowlist = options.allowlist ?? [];
  if (!matchesAllowlist(rawHost, allowlist)) {
    throw new SafeHttpFetchError(
      'denied-not-in-allowlist',
      url,
      `host "${rawHost}" not in allowlist`,
    );
  }
  return { host: rawHost, addresses: all };
}

/**
 * Screen `url` (full `assertUrlSafe` policy) and return an undici
 * `Dispatcher` PINNED to the screened resolution — pass it as the
 * `dispatcher` of a caller-owned `fetch` so the socket dials the exact IP
 * we screened, never a fresh (rebindable) resolution. The Host header +
 * TLS SNI stay the original hostname (the url is unchanged).
 *
 * Returns `undefined` when the host is a literal IP (already pinned by the
 * string gate, nothing to pin). Throws `SafeHttpFetchError` if the url is
 * unsafe. Call this PER ATTEMPT inside a retry loop so a rebind between
 * attempts is re-screened and re-pinned.
 */
export async function pinnedSafeDispatcher(
  url: string,
  options: AssertUrlSafeOptions = {},
): Promise<Dispatcher | undefined> {
  const { addresses } = await assertUrlSafe(url, options);
  if (addresses.length === 0) return undefined;
  return pinnedDispatcher(addresses);
}

// ---------------------------------------------------------------------------
// Diagnostic helpers (exported for tests)
// ---------------------------------------------------------------------------

export const __internals = {
  isInternalHost,
  matchesAllowlist,
  resolveAndScreen,
  pinnedDispatcher,
};
