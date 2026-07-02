/**
 * Owner-web home (/) — persona-greeting render tests.
 *
 * The chat-first home surface is `HomeChatTeach`; the retired `HomeChat`
 * component (superseded by `HomeChatTeach`) was removed, so these tests
 * cover the still-shipping `PersonaGreeting` card it and HomeChatTeach
 * both mount:
 *   1. Renders the persona greeting card with the bilingual Swahili
 *      headline (salutation + trading name) when it mounts fresh.
 *   2. Renders all three suggestion chips ("portfolio overview", "cash
 *      runway", "decisions") with the Swahili copy.
 *   3. Clicking a suggestion chip fires `onSuggestion` with the chip's
 *      exact label.
 *
 * Mirrors the mock conventions used by `ask-page.test.tsx`: next/
 * navigation hooks are stubbed at the module level and rendering happens
 * inside a fresh QueryClientProvider so react-query state cannot leak
 * between cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PersonaGreeting } from '@/components/home-chat/PersonaGreeting';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (_key: string): string | null => null,
  }),
}));

function withClient(ui: ReactNode): JSX.Element {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const baseProps = {
  salutation: 'Mzee Mwanaidi',
  tradingName: 'Mawe Bora',
  languagePreference: 'sw' as const,
};

beforeEach(() => {
  replaceMock.mockClear();
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_API_GATEWAY_URL;
});

describe('PersonaGreeting · persona greeting renders on fresh mount', () => {
  it('shows the bilingual Swahili headline with the salutation and trading name', () => {
    render(withClient(<PersonaGreeting {...baseProps} onSuggestion={vi.fn()} />));
    const headline = screen.getByTestId('home-greeting-headline');
    expect(headline).toBeTruthy();
    expect(headline.textContent ?? '').toContain('Karibu');
    expect(headline.textContent ?? '').toContain('Mzee Mwanaidi');
    const greeting = screen.getByTestId('home-persona-greeting');
    expect(greeting.getAttribute('data-lang')).toBe('sw');
    expect(greeting.textContent ?? '').toContain('Mawe Bora');
  });
});

describe('PersonaGreeting · suggestion chips render in Swahili', () => {
  it('renders three chips with the three documented Swahili prompts', () => {
    render(withClient(<PersonaGreeting {...baseProps} onSuggestion={vi.fn()} />));
    const chips = screen.getAllByTestId('home-suggestion-chip');
    expect(chips).toHaveLength(3);
    const labels = chips.map((c) => c.textContent ?? '').join('|');
    expect(labels).toContain('Onyesha muhtasari wa portfolio');
    expect(labels).toContain('Hali ya hela na siku zilizobaki');
    expect(labels).toContain('Maamuzi yanayosubiri');
  });
});

describe('PersonaGreeting · suggestion chip fires onSuggestion with the chip label', () => {
  it('forwards the Swahili label exactly as shown when the chip is clicked', () => {
    const handler = vi.fn();
    render(
      <PersonaGreeting
        salutation="Mzee Mwanaidi"
        tradingName="Mawe Bora"
        languagePreference="sw"
        onSuggestion={handler}
      />,
    );
    const chips = screen.getAllByTestId('home-suggestion-chip');
    fireEvent.click(chips[0]!);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBe('Onyesha muhtasari wa portfolio');
  });
});
