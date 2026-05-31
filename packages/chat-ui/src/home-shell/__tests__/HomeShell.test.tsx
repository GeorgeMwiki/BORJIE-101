/**
 * HomeShell — smoke render + persona resolution tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HomeShell } from '../HomeShell.js';
import type { HomeShellProps } from '../types.js';

function baseProps(overrides: Partial<HomeShellProps> = {}): HomeShellProps {
  return {
    user_role: 'owner',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    api_base_url: '',
    variant: 'full_screen',
    enable_proactive_banners: true,
    enable_dashboard_link: true,
    initial_language: 'en',
    ...overrides,
  };
}

describe('HomeShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the full-screen shell with the locked canonical persona header', () => {
    // Display identity is locked — the header always shows
    // "Mr. Mwikila — the brain layer within Borjie, an AI-native mining
    // estate operating system", regardless of which internal
    // specialisation routed the turn.
    // See CAPABILITIES_UNIFICATION.md "User-facing identity is locked".
    render(<HomeShell {...baseProps()} />);
    expect(screen.getByTestId('home-shell')).toBeInTheDocument();
    const header = screen.getByTestId('home-persona-header');
    expect(header.textContent ?? '').toContain('Mr. Mwikila');
    expect(header.textContent ?? '').toContain(
      'The brain layer within Borjie — an AI-native mining estate operating system',
    );
  });

  it('shows the Open Dashboard CTA when enabled', () => {
    const onOpenDashboard = vi.fn();
    render(<HomeShell {...baseProps({ onOpenDashboard })} />);
    const btn = screen.getByTestId('home-persona-header-dashboard');
    fireEvent.click(btn);
    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state and composer placeholder in English', () => {
    render(<HomeShell {...baseProps()} />);
    const empty = screen.getByTestId('home-message-list-empty');
    expect(empty.textContent ?? '').toContain("I'm Mr. Mwikila");
    const input = screen.getByTestId('home-composer-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('Type here…');
  });

  it('renders Swahili copy when initial_language is sw', () => {
    render(<HomeShell {...baseProps({ initial_language: 'sw' })} />);
    const empty = screen.getByTestId('home-message-list-empty');
    expect(empty.textContent ?? '').toContain('Mr. Mwikila');
    const input = screen.getByTestId('home-composer-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('Andika hapa…');
  });

  it('routes worker role through the audience resolver but ALWAYS shows the canonical header', () => {
    // The audience resolver still routes the worker to the safety
    // specialisation internally (audit logs, backend routing), but the
    // user-facing header is locked to Mr. Mwikila. The internal
    // specialisation never surfaces in the chat UI.
    render(
      <HomeShell
        {...baseProps({
          user_role: 'worker',
          surface_override: 'workforce-mobile',
        })}
      />,
    );
    const header = screen.getByTestId('home-persona-header');
    expect(header.textContent ?? '').toContain('Mr. Mwikila');
    expect(header.textContent ?? '').toContain(
      'The brain layer within Borjie — an AI-native mining estate operating system',
    );
    expect(header.textContent ?? '').not.toContain('Safety Officer');
  });

  it('routes buyer role through the audience resolver but ALWAYS shows the canonical header', () => {
    render(
      <HomeShell
        {...baseProps({
          user_role: 'buyer',
          surface_override: 'buyer-mobile',
        })}
      />,
    );
    const header = screen.getByTestId('home-persona-header');
    expect(header.textContent ?? '').toContain('Mr. Mwikila');
    expect(header.textContent ?? '').toContain(
      'The brain layer within Borjie — an AI-native mining estate operating system',
    );
    expect(header.textContent ?? '').not.toContain('Marketplace Concierge');
  });

  it('renders the history rail when variant is split_with_history', () => {
    render(
      <HomeShell {...baseProps({ variant: 'split_with_history' })} />,
    );
    expect(screen.getByTestId('home-history-rail')).toBeInTheDocument();
  });

  it('does NOT render the history rail when variant is full_screen', () => {
    render(<HomeShell {...baseProps()} />);
    expect(screen.queryByTestId('home-history-rail')).toBeNull();
  });

  it('appends a user message when send is pressed', () => {
    render(<HomeShell {...baseProps()} />);
    const input = screen.getByTestId('home-composer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hello Mr. Mwikila' } });
    const send = screen.getByTestId('home-composer-send');
    fireEvent.click(send);
    expect(screen.getByTestId('home-message-user').textContent).toBe(
      'Hello Mr. Mwikila',
    );
  });

  it('hides proactive banner when enable_proactive_banners is false', () => {
    render(
      <HomeShell {...baseProps({ enable_proactive_banners: false })} />,
    );
    expect(screen.queryByTestId('home-proactive-banner')).toBeNull();
  });
});
