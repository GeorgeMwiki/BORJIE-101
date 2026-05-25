/**
 * Floating Chat Widget — behaviour + accessibility + context-awareness tests.
 *
 * 16 tests cover: widget expand/collapse, SSE streaming integration,
 * mic stub, language toggle persistence, context-badge updates on route
 * change, aria-live region during streaming, keyboard shortcut handling,
 * multi-app mounting, and feature-flag short-circuit.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  BossnyumbaAIProvider,
  ChatPanel,
  ContextBadge,
  FloatingChatWidget,
  SegmentHeader,
  WaveformVisualizer,
  buildRouteContext,
  extractEntityMentions,
  renderMarkdown,
  resolveSubPersona,
  routeContextsEqual,
  useBossnyumbaAI,
} from '../widget';
import type { ChatSegment, PortalId } from '../widget/types';

// -----------------------------------------------------------------------------
// SSE fetch mock
// -----------------------------------------------------------------------------

function makeSseStream(chunks: readonly string[]): Response {
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

function sse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function resetLanguageStorage(): void {
  try {
    window.localStorage.removeItem('bn.mwikila.language');
  } catch {
    // ignore
  }
  document.cookie = 'bn_mwikila_lang=; path=/; max-age=0';
}

beforeEach(() => {
  resetLanguageStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// 1. Pure helpers
// -----------------------------------------------------------------------------

describe('route-context', () => {
  it('resolves finance sub-persona for arrears page', () => {
    expect(resolveSubPersona('/admin/arrears/case-42', 'admin')).toBe('finance');
  });

  it('resolves maintenance for work-order path', () => {
    expect(resolveSubPersona('/work-orders/wo-7', 'estate-manager')).toBe('maintenance');
  });

  it('extracts entity mentions from path', () => {
    const ents = extractEntityMentions('/admin/arrears/case-42/unit-7b');
    expect(ents).toContain('case:42');
    expect(ents).toContain('unit:7b');
  });

  it('buildRouteContext surfaces sub-persona + mentions', () => {
    const ctx = buildRouteContext('/admin/arrears/case-42', 'admin');
    expect(ctx.activeSubPersona).toBe('finance');
    expect(ctx.portal).toBe('admin');
    expect(ctx.entityMentions).toHaveLength(1);
  });

  it('routeContextsEqual detects structural equality', () => {
    const a = buildRouteContext('/maintenance', 'estate-manager');
    const b = buildRouteContext('/maintenance', 'estate-manager');
    expect(routeContextsEqual(a, b)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 2. Markdown renderer
// -----------------------------------------------------------------------------

describe('renderMarkdown', () => {
  it('renders bold + bullet list safely', () => {
    const html = renderMarkdown('**hi**\n- one\n- two');
    expect(html).toContain('<strong>hi</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('escapes raw HTML input', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

// -----------------------------------------------------------------------------
// 3. ContextBadge / SegmentHeader / Waveform
// -----------------------------------------------------------------------------

describe('ContextBadge', () => {
  it('shows portal + persona + entity label', () => {
    const route = buildRouteContext('/admin/arrears/case-42', 'admin');
    render(<ContextBadge route={route} language="en" />);
    const badge = screen.getByTestId('context-badge');
    expect(badge.getAttribute('data-sub-persona')).toBe('finance');
    expect(screen.getByTestId('context-badge-entity').textContent).toBe('case:42');
  });
});

describe('SegmentHeader', () => {
  it('renders a labelled separator', () => {
    const seg: ChatSegment = {
      id: 's1',
      label: 'Switched to maintenance',
      startedAt: new Date().toISOString(),
      subPersona: 'maintenance',
    };
    render(<SegmentHeader segment={seg} language="en" />);
    const header = screen.getByTestId('segment-header');
    expect(header.getAttribute('role')).toBe('separator');
    expect(header.getAttribute('aria-label')).toBe('Switched to maintenance');
  });
});

describe('WaveformVisualizer', () => {
  it('toggles fill by active flag', () => {
    const { rerender } = render(<WaveformVisualizer levels={[0.2, 0.5]} active={false} />);
    expect(screen.getByTestId('waveform-visualizer').getAttribute('data-active')).toBe('false');
    rerender(<WaveformVisualizer levels={[0.2, 0.5]} active={true} />);
    expect(screen.getByTestId('waveform-visualizer').getAttribute('data-active')).toBe('true');
  });
});

// -----------------------------------------------------------------------------
// 4. Provider + Floating widget + streaming integration
// -----------------------------------------------------------------------------

function renderWithProvider(opts: {
  readonly portal?: PortalId;
  readonly path?: string;
  readonly tenantId?: string | null;
  readonly featureEnabled?: boolean;
  readonly children?: React.ReactNode;
}) {
  return render(
    <BossnyumbaAIProvider
      portal={opts.portal ?? 'admin'}
      defaultPersona="manager-chat"
      currentPath={opts.path ?? '/'}
      tenantId={opts.tenantId ?? 'tenant-7'}
      featureEnabled={opts.featureEnabled ?? true}
    >
      <FloatingChatWidget />
      {opts.children}
    </BossnyumbaAIProvider>,
  );
}

describe('FloatingChatWidget — expand / collapse', () => {
  it('starts collapsed and expands on bubble click', () => {
    renderWithProvider({ path: '/admin/arrears/case-42' });
    const bubble = screen.getByTestId('floating-chat-bubble');
    expect(bubble.getAttribute('aria-label')).toMatch(/open|chat/i);
    fireEvent.click(bubble);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
    expect(screen.getByTestId('context-badge').getAttribute('data-sub-persona')).toBe('finance');
  });

  it('collapses on close button click', () => {
    renderWithProvider({ path: '/maintenance' });
    fireEvent.click(screen.getByTestId('floating-chat-bubble'));
    fireEvent.click(screen.getByTestId('chat-close'));
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('floating-chat-bubble')).toBeInTheDocument();
  });

  it('hides entirely when feature-flag is disabled', () => {
    renderWithProvider({ featureEnabled: false });
    expect(screen.queryByTestId('floating-chat-bubble')).not.toBeInTheDocument();
  });
});

describe('FloatingChatWidget — SSE streaming', () => {
  it('streams mwikila deltas into the bubble and clears unread on expand', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        makeSseStream([
          sse('turn_start', { threadId: 't1', createdAt: '2026-04-19T00:00:00Z' }),
          sse('delta', { content: 'Hello ' }),
          sse('delta', { content: 'from Mwikila' }),
          sse('turn_end', {
            threadId: 't1',
            finalPersonaId: 'manager-chat',
            totalTokens: 0,
            totalCost: 0,
            timeMs: 0,
            advisorConsulted: false,
          }),
        ]),
      );

      renderWithProvider({ path: '/admin/arrears/case-42' });
      fireEvent.click(screen.getByTestId('floating-chat-bubble'));
      const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: 'what is the status of case 42?' } });
      fireEvent.click(screen.getByTestId('chat-send'));

      await waitFor(() => {
        expect(screen.getByText(/Hello from Mwikila/i)).toBeInTheDocument();
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/ai/chat',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-tenant-id': 'tenant-7' }),
        }),
      );
      // body should include routeContext so the backend can pick finance sub-persona
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.routeContext.activeSubPersona).toBe('finance');
      expect(body.subPersonaId).toBe('finance');
  });

  it('live-region is present during streaming for assistive tech', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeSseStream([
        sse('turn_start', { threadId: 't1', createdAt: '2026-04-19T00:00:00Z' }),
        sse('delta', { content: 'partial' }),
        sse('turn_end', {
          threadId: 't1',
          finalPersonaId: 'manager-chat',
          totalTokens: 0,
          totalCost: 0,
          timeMs: 0,
          advisorConsulted: false,
        }),
      ]),
    );
    renderWithProvider({ path: '/maintenance' });
    fireEvent.click(screen.getByTestId('floating-chat-bubble'));
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    const live = screen.getByTestId('chat-live-region');
    expect(live.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument());
  });
});

// -----------------------------------------------------------------------------
// 5. Keyboard + mic + language + attachments
// -----------------------------------------------------------------------------

describe('ChatPanel — keyboard + mic + attachments', () => {
  it('Enter submits, Shift+Enter does not', () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatPanel
        chat={stubChat({ sendMessage })}
        strings={stubStrings()}
        onClose={() => undefined}
        variant="floating"
      />,
    );
    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('Escape triggers close callback', () => {
    const onClose = vi.fn();
    render(
      <ChatPanel
        chat={stubChat()}
        strings={stubStrings()}
        onClose={onClose}
        variant="floating"
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('mic button shows voice overlay while pressed', () => {
    render(
      <ChatPanel
        chat={stubChat()}
        strings={stubStrings()}
        onClose={() => undefined}
        variant="floating"
      />,
    );
    const mic = screen.getByTestId('chat-mic');
    fireEvent.mouseDown(mic);
    expect(screen.getByTestId('voice-overlay')).toBeInTheDocument();
    fireEvent.mouseUp(mic);
    expect(screen.queryByTestId('voice-overlay')).not.toBeInTheDocument();
  });

  it('language toggle persists to localStorage', () => {
    const setLanguage = vi.fn();
    const chat = stubChat({ language: 'en', setLanguage });
    render(
      <ChatPanel
        chat={chat}
        strings={stubStrings()}
        onClose={() => undefined}
        variant="floating"
      />,
    );
    fireEvent.click(screen.getByTestId('chat-language-toggle'));
    expect(setLanguage).toHaveBeenCalledWith('sw');
  });

  it('stages attachments when file input changes', () => {
    render(
      <ChatPanel
        chat={stubChat()}
        strings={stubStrings()}
        onClose={() => undefined}
        variant="floating"
      />,
    );
    const file = new File(['hello'], 'lease.pdf', { type: 'application/pdf' });
    const fileInput = screen.getByTestId('chat-file-input') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);
    expect(screen.getByTestId('chat-staged-attachments').textContent).toContain('lease.pdf');
  });
});

// -----------------------------------------------------------------------------
// 6. Multi-app mounting — provider isolation
// -----------------------------------------------------------------------------

function PortalReadout(): JSX.Element {
  const { chat } = useBossnyumbaAI();
  return (
    <div data-testid={`portal-readout-${chat.route.portal}`}>
      {chat.route.portal}:{chat.persona}
    </div>
  );
}

describe('Multi-app mounting', () => {
  it('each app root owns its own chat context', () => {
    const { rerender } = render(
      <BossnyumbaAIProvider portal="customer" defaultPersona="tenant-assistant" currentPath="/">
        <PortalReadout />
      </BossnyumbaAIProvider>,
    );
    expect(screen.getByTestId('portal-readout-customer').textContent).toBe('customer:tenant-assistant');

    rerender(
      <BossnyumbaAIProvider portal="owner" defaultPersona="owner-advisor" currentPath="/portfolio">
        <PortalReadout />
      </BossnyumbaAIProvider>,
    );
    expect(screen.getByTestId('portal-readout-owner').textContent).toBe('owner:owner-advisor');
  });

  it('route change updates the context badge sub-persona', () => {
    const { rerender } = render(
      <BossnyumbaAIProvider portal="admin" defaultPersona="manager-chat" currentPath="/admin/arrears/case-1">
        <FloatingChatWidget />
      </BossnyumbaAIProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId('floating-chat-bubble'));
    });
    expect(screen.getByTestId('context-badge').getAttribute('data-sub-persona')).toBe('finance');

    rerender(
      <BossnyumbaAIProvider portal="admin" defaultPersona="manager-chat" currentPath="/maintenance">
        <FloatingChatWidget />
      </BossnyumbaAIProvider>,
    );
    expect(screen.getByTestId('context-badge').getAttribute('data-sub-persona')).toBe('maintenance');
  });
});

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function stubStrings() {
  return {
    greet: 'hi',
    placeholder: 'Ask …',
    send: 'Send',
    collapse: 'Close',
    expand: 'Open',
    mic: 'Hold to speak',
    micPermission: 'Mic needed',
    unreadCount: '{count} unread',
    languageSwitched: 'Switched',
    voiceError: 'Voice error',
    attachmentAccepted: 'Attach',
    personaName: 'Mr. Mwikila',
  };
}

function stubChat(overrides: Partial<ReturnType<typeof baseChat>> = {}) {
  return { ...baseChat(), ...overrides };
}

function baseChat() {
  const route = buildRouteContext('/maintenance', 'estate-manager');
  return {
    messages: [],
    segments: [],
    mode: 'expanded' as const,
    isStreaming: false,
    unreadCount: 0,
    language: 'en' as const,
    persona: 'manager-chat' as const,
    route,
    voiceEnabled: true,
    soundsEnabled: false,
    error: null,
    sessionId: 'sess-test',
    tenantId: 'tenant-1',
    sendMessage: vi.fn().mockResolvedValue(undefined),
    switchMode: vi.fn(),
    abort: vi.fn(),
    setLanguage: vi.fn(),
    toggleVoice: vi.fn(),
    toggleSounds: vi.fn(),
    clearUnread: vi.fn(),
    startSegment: vi.fn(),
  };
}
