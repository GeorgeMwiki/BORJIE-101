/**
 * FloatingAskBorjie — widget behaviour tests.
 *
 * Covers: renders FAB, opens on click, sends a message and streams a
 * mock SSE response, closes on ESC, and re-renders sign-in prompt
 * when the authenticated variant has no access token.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FloatingAskBorjie } from '../borjie/FloatingAskBorjie';

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
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a floating FAB collapsed by default', async () => {
    render(<FloatingAskBorjie variant="public" />);
    const fab = await screen.findByTestId('borjie-fab');
    expect(fab).toBeInTheDocument();
    expect(screen.queryByTestId('borjie-chat-panel')).toBeNull();
  });

  it('opens the panel when the FAB is clicked and shows the intro', async () => {
    render(<FloatingAskBorjie variant="public" />);
    const fab = await screen.findByTestId('borjie-fab');
    fireEvent.click(fab);
    const panel = await screen.findByTestId('borjie-chat-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId('borjie-intro').textContent).toMatch(/AI mining operations manager/i);
  });

  it('sends a message and renders streamed assistant text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeSseResponse([
        'event: turn.accepted\ndata: {"mode":"build"}\n\n',
        'event: message_chunk\ndata: {"text":"Hello ","evidence_ids":[]}\n\n',
        'event: message_chunk\ndata: {"text":"world","evidence_ids":["ev_1"]}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FloatingAskBorjie variant="public" apiBaseUrl="" />);
    fireEvent.click(await screen.findByTestId('borjie-fab'));
    const input = await screen.findByTestId('borjie-input');
    fireEvent.change(input, { target: { value: 'what is Borjie?' } });
    fireEvent.click(screen.getByTestId('borjie-send'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/public/chat',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    await waitFor(() => {
      const bubble = screen.getByTestId('borjie-bubble-assistant');
      expect(bubble.textContent ?? '').toContain('Hello world');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('borjie-evidence-chip')?.textContent).toBe('ev_1');
    });
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
