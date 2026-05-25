/**
 * Dynamic-registry fetch port.
 *
 * Brain-llm-router is intentionally zero-dep (see package.json). To
 * still benefit from the canonical `safeHttpFetch` SSRF guard at
 * runtime, we accept a fetch *port* — an injected shape that
 * composition roots wire to `@borjie/enterprise-hardening`'s
 * `safeHttpFetch`. When no port is set, we fall back to a thin
 * `fetch` + `AbortController` shim so the package remains usable in
 * isolation (tests, local repls).
 *
 * The shape **matches** `SafeHttpFetchResult` from enterprise-hardening
 * so the adapter is a 1-line pass-through at the composition root.
 */

export interface DynamicRegistryFetchResult {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface DynamicRegistryFetchOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export type DynamicRegistryFetchPort = (
  url: string,
  options?: DynamicRegistryFetchOptions,
) => Promise<DynamicRegistryFetchResult>;

let injectedPort: DynamicRegistryFetchPort | null = null;

/**
 * Composition-root entrypoint. Call once at boot from the api-gateway
 * (or any host that has imported `safeHttpFetch`) to bind the canonical
 * SSRF-guarded fetcher. Idempotent — last write wins.
 */
export function setFetchPort(port: DynamicRegistryFetchPort): void {
  injectedPort = port;
}

/** Test-only — restore the default (raw-fetch) port. */
export function clearFetchPort(): void {
  injectedPort = null;
}

/**
 * Default port — used when no `safeHttpFetch` has been injected. Does
 * NOT include SSRF protection; the resolver only ever calls this with
 * **literal hostnames** baked into `FAMILY_PATTERNS` (api.anthropic.com,
 * api.openai.com, etc.), so SSRF surface is limited at compile time.
 * Still, prefer composition-root injection in production.
 */
async function defaultPort(
  url: string,
  options?: DynamicRegistryFetchOptions,
): Promise<DynamicRegistryFetchResult> {
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 5_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method: options?.method ?? 'GET',
      signal: controller.signal,
    };
    if (options?.headers) {
      init.headers = options.headers as Record<string, string>;
    }
    const res = await fetch(url, init);
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      status: res.status,
      ok: res.ok,
      headers,
      json: () => res.json(),
      text: () => res.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getFetchPort(): DynamicRegistryFetchPort {
  return injectedPort ?? defaultPort;
}
