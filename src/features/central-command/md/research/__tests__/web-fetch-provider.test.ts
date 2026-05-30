/**
 * Tests for makeWebFetchProvider.
 *
 * Coverage:
 *   - HTTPS-only (http://, file://, ftp:// rejected — SSRF defence)
 *   - Private-IP / link-local / metadata-host block (C-4 fix)
 *   - User-Agent header set
 *   - Title extracted from <title> with HTML stripping
 *   - Fallback title from <h1> when <title> absent
 *   - Text excerpt strips <script>, <style>, <noscript>
 *   - Body cap honored (returns truncated text)
 *   - Non-OK status throws
 *   - Unsupported content-type throws
 */

import { describe, it, expect, vi } from "vitest";

import { makeWebFetchProvider } from "../web-fetch-provider";

function htmlResp(body: string, contentType = "text/html"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("makeWebFetchProvider — scheme + SSRF guards", () => {
  it("rejects http:// (HTTPS-only)", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("http://example.com/")).rejects.toThrow(
      /unsupported-scheme/,
    );
  });

  it("rejects file:// scheme", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("file:///etc/passwd")).rejects.toThrow(
      /unsupported-scheme/,
    );
  });

  it("rejects ftp:// scheme", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("ftp://server/file")).rejects.toThrow(
      /unsupported-scheme/,
    );
  });

  it("blocks AWS metadata endpoint (169.254.169.254)", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      provider("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/blocked-host/);
  });

  it("blocks GCP metadata DNS name", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      provider("https://metadata.google.internal/computeMetadata/v1/"),
    ).rejects.toThrow(/blocked-host/);
  });

  it("blocks private RFC1918 ranges (10/8, 172.16/12, 192.168/16)", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("https://10.0.0.1/")).rejects.toThrow(/blocked-host/);
    await expect(provider("https://172.20.5.1/")).rejects.toThrow(
      /blocked-host/,
    );
    await expect(provider("https://192.168.1.1/")).rejects.toThrow(
      /blocked-host/,
    );
  });

  it("blocks loopback (127.0.0.1) and localhost", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("https://127.0.0.1/")).rejects.toThrow(
      /blocked-host/,
    );
    await expect(provider("https://localhost/")).rejects.toThrow(
      /blocked-host/,
    );
  });

  it("blocks .internal / .local / .lan suffixes", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("https://api.internal/")).rejects.toThrow(
      /blocked-host/,
    );
    await expect(provider("https://printer.local/")).rejects.toThrow(
      /blocked-host/,
    );
  });

  it("blocks short bare hostnames (no dots)", async () => {
    const provider = makeWebFetchProvider({
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(provider("https://shortname/")).rejects.toThrow(
      /blocked-host/,
    );
  });

  it("allows a normal public hostname", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response("<html><title>OK</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("https://example.com/");
    expect(out.title).toBe("OK");
  });
});

describe("makeWebFetchProvider — happy paths", () => {
  it("returns the parsed title + stripped text excerpt", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["User-Agent"]).toContain("BorjieMDResearcher");
      return htmlResp(
        `<html><head><title> Hello &amp; World </title></head>
         <body>
           <script>const x = 1;</script>
           <p>Body <b>text</b> here.</p>
         </body></html>`,
      );
    });
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("https://example.com/x");
    expect(out.title).toContain("Hello");
    expect(out.title).not.toContain("<");
    expect(out.textExcerpt).toContain("Body");
    expect(out.textExcerpt).not.toContain("const x = 1");
  });

  it("falls back to <h1> when <title> is missing", async () => {
    const fetchSpy = vi.fn(async () =>
      htmlResp(`<html><body><h1>Big Heading</h1></body></html>`),
    );
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("https://example.com/y");
    expect(out.title).toBe("Big Heading");
  });

  it("honours the body size cap", async () => {
    const big = "a".repeat(50_000);
    const fetchSpy = vi.fn(async () => htmlResp(big));
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
      maxBytes: 1_000,
    });
    const out = await provider("https://example.com/z");
    expect(out.textExcerpt.length).toBeLessThanOrEqual(5_000);
  });
});

describe("makeWebFetchProvider — failure paths", () => {
  it("throws on non-OK status", async () => {
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 404 }));
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    await expect(provider("https://example.com/notfound")).rejects.toThrow(
      /status-404/,
    );
  });

  it("throws on unsupported content-type (application/pdf)", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response("%PDF-1.4", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    );
    const provider = makeWebFetchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    await expect(provider("https://example.com/x.pdf")).rejects.toThrow(
      /unsupported-content-type/,
    );
  });
});
