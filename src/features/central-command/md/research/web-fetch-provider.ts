/**
 * WebFetchProvider — server-side page fetch with UA + size cap +
 * text-only extraction.
 *
 * Pairs with `WebSearchProvider`. After the search provider returns
 * candidate URLs, the MD's `runDeepResearch` calls this provider for
 * the top N. The fetch:
 *
 *   - Respects an HTTPS-only allowlist (no file:// or http:// in v1).
 *   - Sends a `BorjieMDResearcher` UA so the upstream can identify
 *     and (optionally) rate-limit us.
 *   - Hard-caps body bytes (default 100 KB, configurable per call).
 *   - Strips HTML to a plain-text excerpt with collapsed whitespace.
 *   - Times out per-request (default 8 s).
 *   - Returns the resolved URL (which honors `Location` redirects)
 *     so citations show the canonical page.
 *
 * Anything that goes wrong (DNS, status >= 400, body too large,
 * unsupported content-type) throws; the synthesis layer treats the
 * throw as a per-URL skip rather than a turn-level failure.
 *
 * @module features/central-command/md/research/web-fetch-provider
 */

import { createLogger } from "@/lib/logger";

import type { WebFetchProvider } from "./deep-research";

const log = createLogger("md.research.web-fetch");

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 100_000;
const ALLOWED_CONTENT_TYPES = Object.freeze([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

export interface MakeWebFetchProviderOptions {
  /** Per-request timeout (default 8 s). */
  readonly timeoutMs?: number;
  /** Hard cap on body bytes (default 100 KB). */
  readonly maxBytes?: number;
  /** Override the User-Agent string. */
  readonly userAgent?: string;
  /** Inject a custom fetch (test seam). */
  readonly fetchImpl?: typeof fetch;
}

export function makeWebFetchProvider(
  options: MakeWebFetchProviderOptions = {},
): WebFetchProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fallbackMaxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const ua =
    options.userAgent ??
    "BorjieMDResearcher/1.0 (+https://borjie.co.tz/research)";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async (
    url: string,
    opts?: { readonly maxBytes?: number },
  ): Promise<{
    readonly url: string;
    readonly title: string;
    readonly textExcerpt: string;
  }> => {
    // C-4 (SSRF) fix: HTTPS-only + private-IP / link-local block.
    // The previous version comment said "HTTPS-only allowlist" but
    // the code accepted both schemes AND never inspected the host.
    // An owner-typed prompt could pivot the brain into AWS metadata
    // (169.254.169.254), GCP metadata (metadata.google.internal),
    // or any internal microservice.
    if (!url.startsWith("https://")) {
      throw new Error("md.web-fetch.unsupported-scheme");
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("md.web-fetch.malformed-url");
    }
    if (isBlockedHost(parsedUrl.hostname)) {
      throw new Error(`md.web-fetch.blocked-host:${parsedUrl.hostname}`);
    }
    const maxBytes = Math.max(
      1_000,
      Math.min(2_000_000, opts?.maxBytes ?? fallbackMaxBytes),
    );

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        },
        // Redirects follow by default. We rely on `res.url` to capture
        // the post-redirect canonical URL.
        redirect: "follow",
      });
    } finally {
      clearTimeout(tid);
    }

    if (!res.ok) {
      log.warn("md.web-fetch.non-ok", { url, status: res.status });
      throw new Error(`md.web-fetch.status-${res.status}`);
    }

    const ct = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (ct && !ALLOWED_CONTENT_TYPES.includes(ct)) {
      throw new Error(`md.web-fetch.unsupported-content-type:${ct}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      // Server-side `fetch` may return a body-less Response in some
      // edge cases (HEAD-only adapters); fall back to res.text() with
      // the same cap.
      const text = (await res.text()).slice(0, maxBytes);
      return shapeOutput(res.url || url, text);
    }

    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let buffer = "";
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      if (received >= maxBytes) break;
    }
    buffer += decoder.decode();
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }

    return shapeOutput(res.url || url, buffer.slice(0, maxBytes));
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function shapeOutput(
  finalUrl: string,
  rawBody: string,
): {
  readonly url: string;
  readonly title: string;
  readonly textExcerpt: string;
} {
  const title = extractTitle(rawBody);
  const textExcerpt = stripToText(rawBody).slice(0, 5_000);
  return Object.freeze({
    url: finalUrl,
    title,
    textExcerpt,
  });
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html);
  if (m) {
    return collapseWhitespace(stripTags(m[1])).trim().slice(0, 200);
  }
  // Fallback: try the first <h1>.
  const h = /<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i.exec(html);
  if (h) return collapseWhitespace(stripTags(h[1])).trim().slice(0, 200);
  return "(untitled)";
}

function stripToText(html: string): string {
  // Drop scripts + styles entirely, then unwrap remaining tags.
  return collapseWhitespace(
    stripTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
    ),
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

// SSRF defence: reject any hostname that resolves (or matches by
// literal IP / suspicious suffix) to a private, link-local, or
// metadata-service address. This is a structural deny — we never
// even let the fetch issue.
//
// The literal-IP checks cover IPv4 RFC1918 (10/8, 172.16/12,
// 192.168/16), loopback (127/8), link-local (169.254/16 — includes
// AWS / GCP metadata), and the IPv6 loopback / link-local prefixes.
// Hostname suffix checks block `.internal`, `.local`, `localhost`,
// and the canonical cloud-metadata DNS name. Anything that doesn't
// look like a public hostname is denied by default.
const BLOCKED_HOST_SUFFIXES = [
  ".internal",
  ".local",
  ".localdomain",
  ".lan",
  ".intranet",
];
const BLOCKED_HOST_NAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
  "metadata.azure.internal",
]);

export function isBlockedHost(host: string): boolean {
  const lower = host.toLowerCase().trim();
  if (lower.length === 0) return true;
  if (BLOCKED_HOST_NAMES.has(lower)) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }
  // IPv4 literal
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4) {
    const oct = ipv4.slice(1).map((s) => Number.parseInt(s, 10));
    if (oct.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = oct;
    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 100.64.0.0/10 (carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local + cloud metadata)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 192.168.0.0/16
    if (a === 192 && (b === 0 || b === 88 || b === 168)) return true;
    // 198.18.0.0/15
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    if (a >= 224) return true;
    return false;
  }
  // IPv6 literal (bare — URL may strip brackets)
  if (lower.includes(":")) {
    // ::1, fe80::/10, fc00::/7 (ULA), ::ffff:127.0.0.1 etc
    if (lower === "::1" || lower === "::") return true;
    if (
      lower.startsWith("fe80:") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    )
      return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return true;
  }
  // Plain "no dots" hosts that aren't already blocked above are
  // suspicious — likely internal short-names.
  if (!lower.includes(".")) return true;
  return false;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
