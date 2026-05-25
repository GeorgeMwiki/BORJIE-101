/**
 * DegradedBanner — visibility tests for the shared brain-degraded
 * indicator that owner-portal, customer-app, and chat-ui's floating
 * widget all consume.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DegradedBanner,
  type DegradedMarker,
} from '../components/DegradedBanner';

describe('DegradedBanner', () => {
  it('renders nothing when degraded prop is undefined', () => {
    const { container } = render(<DegradedBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when degraded prop is null', () => {
    const { container } = render(<DegradedBanner degraded={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a warning banner when degraded is set', () => {
    const degraded: DegradedMarker = {
      reason: 'sensor primary breaker open',
      affected_capabilities: ['sensor:primary'],
    };
    render(<DegradedBanner degraded={degraded} />);
    expect(screen.getByTestId('degraded-banner')).toBeInTheDocument();
    expect(
      screen.getByText(
        /AI brain operating in fallback mode\. Some advanced features may be limited\./i,
      ),
    ).toBeInTheDocument();
  });

  it('exposes the reason via the body copy', () => {
    const degraded: DegradedMarker = {
      reason: 'kra-mri-dispatcher refused',
      affected_capabilities: ['kra-mri-dispatcher'],
    };
    render(<DegradedBanner degraded={degraded} />);
    expect(screen.getByText(/kra-mri-dispatcher refused/i)).toBeInTheDocument();
  });

  it('renders each affected capability as a pill', () => {
    const degraded: DegradedMarker = {
      reason: 'multiple tools refused',
      affected_capabilities: ['nida-port', 'kra-mri-dispatcher'],
    };
    render(<DegradedBanner degraded={degraded} />);
    const list = screen.getByTestId('degraded-capabilities');
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('nida-port');
    expect(list.textContent).toContain('kra-mri-dispatcher');
  });

  it('hides the affected-capabilities pill row in compact mode', () => {
    const degraded: DegradedMarker = {
      reason: 'sensor secondary',
      affected_capabilities: ['sensor:secondary'],
    };
    render(<DegradedBanner degraded={degraded} compact />);
    expect(screen.queryByTestId('degraded-capabilities')).not.toBeInTheDocument();
  });

  it('renders the since timestamp when provided', () => {
    const degraded: DegradedMarker = {
      reason: 'primary down',
      affected_capabilities: ['sensor:primary'],
      since: '2026-05-21T10:42:00Z',
    };
    render(<DegradedBanner degraded={degraded} />);
    expect(screen.getByTestId('degraded-since')).toHaveTextContent(
      'Since 2026-05-21T10:42:00Z',
    );
  });

  it('omits the since line when no timestamp is provided', () => {
    const degraded: DegradedMarker = {
      reason: 'primary down',
      affected_capabilities: ['sensor:primary'],
    };
    render(<DegradedBanner degraded={degraded} />);
    expect(screen.queryByTestId('degraded-since')).not.toBeInTheDocument();
  });

  it('uses the default learn-more href when none is provided', () => {
    const degraded: DegradedMarker = {
      reason: 'r',
      affected_capabilities: [],
    };
    render(<DegradedBanner degraded={degraded} />);
    const link = screen.getByTestId('degraded-learn-more') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/help/degraded-mode');
  });

  it('honours the custom learnMoreHref override', () => {
    const degraded: DegradedMarker = {
      reason: 'r',
      affected_capabilities: [],
    };
    render(
      <DegradedBanner
        degraded={degraded}
        learnMoreHref="/healthz/dependencies"
      />,
    );
    const link = screen.getByTestId('degraded-learn-more') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/healthz/dependencies');
  });

  it('honours custom headline + body i18n overrides', () => {
    const degraded: DegradedMarker = {
      reason: 'x',
      affected_capabilities: [],
    };
    render(
      <DegradedBanner
        degraded={degraded}
        headline="Akili imepunguzwa"
        body="Mwikila anatumia chelezo"
      />,
    );
    expect(screen.getByText('Akili imepunguzwa')).toBeInTheDocument();
    expect(screen.getByText('Mwikila anatumia chelezo')).toBeInTheDocument();
  });

  it('exposes a status role + polite live region', () => {
    const degraded: DegradedMarker = {
      reason: 'r',
      affected_capabilities: ['sensor:primary'],
    };
    render(<DegradedBanner degraded={degraded} />);
    const banner = screen.getByTestId('degraded-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('exposes the reason via a data attribute for analytics hooks', () => {
    const degraded: DegradedMarker = {
      reason: 'sensor:primary down',
      affected_capabilities: ['sensor:primary'],
    };
    render(<DegradedBanner degraded={degraded} />);
    expect(screen.getByTestId('degraded-banner')).toHaveAttribute(
      'data-degraded-reason',
      'sensor:primary down',
    );
  });
});
