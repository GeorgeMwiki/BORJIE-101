/**
 * FloatingAskBorjie — widget behaviour tests.
 *
 * Covers: renders FAB, opens on click, sends a message and streams a
 * mock SSE response, closes on ESC, and re-renders sign-in prompt
 * when the authenticated variant has no access token.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FloatingAskBorjie } from '../borjie/FloatingAskBorjie';

// These tests assert on streamed (mock SSE) assistant text via waitFor. Under
// parallel CI load (full `pnpm -r test` + apps on one runner) the default 1000ms
// async-util timeout is too tight and flakes — it passes in isolation. Raising
// the timeout makes the streaming assertions robust without weakening them.
configure({ asyncUtilTimeout: 15000 });

function makeSseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('FloatingAskBorjie', () => {
  // The component's `baseUrl` falls back to NEXT_PUBLIC_API_GATEWAY_URL when
  // no apiBaseUrl prop is given. CI sets that var to a placeholder
  // (https://ci-build.borjie.invalid), which made the fetch URLs ABSOLUTE in
  // CI but relative locally — so the exact-URL assertions below passed
  // locally and failed deterministically in CI. Pin it empty for the suite
  // so `${baseUrl}/api/v1/public/chat` is the relative path everywhere.
  let savedGatewayUrl: string | undefined;
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    // The widget now resolves language from the `borjie_locale` page cookie —
    // clear it so a case from another suite can never leak a locale in here.
    document.cookie = 'borjie_locale=; path=/; max-age=0';
    savedGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (savedGatewayUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    } else {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = savedGatewayUrl;
    }
  });

  it('renders a floating FAB collapsed by default', async () => {
    render(<FloatingAskBorjie variant="public" />);
    const fab = await screen.findByTestId('borjie-fab');
    expect(fab).toBeInTheDocument();
    expect(screen.queryByTestId('borjie-chat-panel')).toBeNull();
  });

  // 20s timeout: multi-step mock-SSE stream + chained waitFor blocks; the 5s
  // default is too tight under loaded CI runners (passes in ~0.2s locally).
  it('opens the panel and fires a synthetic hello so the live brain greets', { timeout: 20_000 }, async () => {
    // The canned welcome bubble was removed — instead the panel
    // dispatches one synthetic "hello" to /api/v1/public/chat on
    // first open so the Anthropic-backed persona generates the
    // greeting. The widget header renders the canonical persona name +
    // the short headerRole line (the long single-string identity stays
    // on the dialog's aria-label, not in the visible header text).
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          'event: turn.accepted\ndata: {"mode":"build"}\n\n',
          'event: message_chunk\ndata: {"text":"Hi, I run your mining business.","evidence_ids":[]}\n\n',
          'event: done\ndata: {}\n\n',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    const fab = await screen.findByTestId('borjie-fab');
    fireEvent.click(fab);
    const panel = await screen.findByTestId('borjie-chat-panel');
    expect(panel).toBeInTheDocument();
    // The visible header shows the persona name + the short EN role line
    // (default locale). The long single-string identity is on aria-label.
    expect(panel.textContent ?? '').toMatch(/Mr\. Mwikila/i);
    expect(panel.textContent ?? '').toMatch(/AI Mining Director/i);
    expect(panel.getAttribute('aria-label') ?? '').toMatch(
      /the brain layer within Borjie/i,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/public/chat',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message":"hello"'),
        }),
      );
    });
    // The canned welcome card is gone.
    expect(screen.queryByTestId('borjie-intro')).toBeNull();
    // Multi-step async SSE streaming + chained waitFor blocks; the 5s default
    // is too tight under loaded CI runners (passes in ~0.2s locally).
  });

  it('sends a message and renders streamed assistant text', { timeout: 20_000 }, async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        makeSseResponse([
          'event: turn.accepted\ndata: {"mode":"build"}\n\n',
          'event: message_chunk\ndata: {"text":"Hello ","evidence_ids":[]}\n\n',
          'event: message_chunk\ndata: {"text":"world","evidence_ids":["ev_1"]}\n\n',
          'event: done\ndata: {}\n\n',
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    fireEvent.click(await screen.findByTestId('borjie-fab'));
    const input = await screen.findByTestId('borjie-input');
    // Wait for the synthetic auto-greet to finish so the composer is
    // not blocked by `isStreaming` when the test types its message.
    await waitFor(() => {
      const send = screen.getByTestId('borjie-send') as HTMLButtonElement;
      expect(send.disabled).toBe(true); // disabled because draft is empty
      expect(fetchMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      // The auto-greet finishes streaming "Hi, I run your mining business."
      // before we type the user's real question.
      const bubble = screen.getByTestId('borjie-bubble-assistant');
      expect(bubble.textContent ?? '').toContain('Hello world');
    });
    fireEvent.change(input, { target: { value: 'what is Borjie?' } });
    fireEvent.click(screen.getByTestId('borjie-send'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('/api/v1/public/chat');
    });
    await waitFor(() => {
      const bubbles = screen.getAllByTestId('borjie-bubble-assistant');
      const concat = bubbles.map((b) => b.textContent ?? '').join(' ');
      expect(concat).toContain('Hello world');
    });
    await waitFor(() => {
      const chips = screen.getAllByTestId('borjie-evidence-chip');
      expect(chips.some((c) => c.textContent === 'ev_1')).toBe(true);
    });
    // Heaviest test (two streamed turns + evidence chips); 5s default is too
    // tight under loaded CI runners (passes in ~0.2s locally).
  });

  it('closes the panel when ESC is pressed', async () => {
    render(<FloatingAskBorjie variant="public" />);
    fireEvent.click(await screen.findByTestId('borjie-fab'));
    await screen.findByTestId('borjie-chat-panel');
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('borjie-chat-panel')).toBeNull();
    });
    expect(screen.getByTestId('borjie-fab')).toBeInTheDocument();
  });

  it('shows the sign-in prompt for authenticated variant without a token', async () => {
    render(
      <FloatingAskBorjie
        variant="authenticated"
        getAccessToken={async () => null}
        signInHref="/sign-in"
      />,
    );
    fireEvent.click(await screen.findByTestId('borjie-fab'));
    const prompt = await screen.findByTestId('borjie-signin-prompt');
    expect(prompt).toBeInTheDocument();
    expect(screen.queryByTestId('borjie-input')).toBeNull();
  });
});

/**
 * Language resolution — the floating widget MUST follow the app-wide
 * `borjie_locale` page cookie (the single source of truth), mirroring
 * `readStoredLanguage()` in widget/useWidgetLanguage.ts. This is the
 * zero-mix canon: a fresh visitor on a Swahili page can never get an
 * English widget. Priority: page cookie → legacy widget key → 'en'.
 *
 * We assert on the collapsed FAB's localized aria-label so no SSE fetch is
 * involved — the cheapest deterministic locale probe.
 */
describe('FloatingAskBorjie — page-locale (borjie_locale) resolution', () => {
  const ARIA_EN = 'Open Borjie chat';
  const ARIA_SW = 'Fungua mazungumzo ya Borjie';
  const STORAGE_LANG = 'borjie.chat.lang';

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.cookie = 'borjie_locale=; path=/; max-age=0';
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.cookie = 'borjie_locale=; path=/; max-age=0';
  });

  it('follows borjie_locale=sw for a fresh visitor (no widget key) — no EN-widget-on-SW-page', async () => {
    document.cookie = 'borjie_locale=sw; path=/';
    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    const fab = await screen.findByTestId('borjie-fab');
    await waitFor(() => expect(fab).toHaveAttribute('aria-label', ARIA_SW));
  });

  it('defaults to English when neither a page cookie nor a widget key exist', async () => {
    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    const fab = await screen.findByTestId('borjie-fab');
    await waitFor(() => expect(fab).toHaveAttribute('aria-label', ARIA_EN));
  });

  it('lets the borjie_locale page cookie win over a stale legacy widget key (single source of truth)', async () => {
    // The per-widget key is a stale 'en' from a prior session, but the page
    // is now 'sw' — the widget must follow the PAGE, never render EN on SW.
    window.localStorage.setItem(STORAGE_LANG, 'en');
    document.cookie = 'borjie_locale=sw; path=/';
    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    const fab = await screen.findByTestId('borjie-fab');
    await waitFor(() => expect(fab).toHaveAttribute('aria-label', ARIA_SW));
  });

  it('falls back to the legacy widget key only when no page cookie is set', async () => {
    window.localStorage.setItem(STORAGE_LANG, 'sw');
    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    const fab = await screen.findByTestId('borjie-fab');
    await waitFor(() => expect(fab).toHaveAttribute('aria-label', ARIA_SW));
  });
});
