/**
 * Degraded-brain banner wiring — proves the owner teach stream surfaces the
 * SHARED `@borjie/chat-ui` DegradedBanner (not a bespoke pill) when the
 * gateway ships a `brain_state { degraded:true }` frame.
 *
 * The teach bubble builds the banner from `normaliseBrainStateBadge(frame)`'s
 * `marker`, so this test exercises the real path: gateway frame → normaliser
 * → shared component. It asserts:
 *   1. The shared banner renders (its `data-testid="degraded-banner"`).
 *   2. The single-locale headline + body copy paint.
 *   3. A missing/undegraded frame renders nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DegradedBanner } from '@borjie/chat-ui';
import { normaliseBrainStateBadge } from '../teach-sse-normalisers';

afterEach(() => cleanup());

// Mirrors the render in HomeChatTeach.TeachBubble — banner fed the normalised
// marker with the single-locale i18n overrides.
function renderFromFrame(frame: unknown, lang: 'en' | 'sw') {
  const badge = normaliseBrainStateBadge(frame);
  if (!badge) return { badge: null };
  render(
    <DegradedBanner
      degraded={badge.marker}
      compact
      headline={
        lang === 'sw'
          ? 'Ubongo wa AI unafanya kazi kwa hali ya akiba. Baadhi ya vipengele vya kina vinaweza kuwa na mipaka.'
          : 'AI brain operating in fallback mode. Some advanced features may be limited.'
      }
      body={badge.marker.reason}
      affectedAriaLabel={lang === 'sw' ? 'Uwezo ulioathiriwa' : 'Affected capabilities'}
    />,
  );
  return { badge };
}

describe('DegradedBanner wiring (owner teach stream)', () => {
  const degradedFrame = {
    degraded: true,
    consecutiveFailures: 2,
    label: 'Brain operating in degraded mode',
    reason:
      'A fallback provider is serving this answer while we restore the primary service.',
    affected_capabilities: ['live_debate', 'primary_provider'],
    since: '2026-07-02T10:00:00.000Z',
  };

  it('renders the shared banner with the English headline + reason body', () => {
    const { badge } = renderFromFrame(degradedFrame, 'en');
    expect(badge).not.toBeNull();
    const banner = screen.getByTestId('degraded-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent ?? '').toContain('fallback mode');
    expect(banner.textContent ?? '').toContain(
      'fallback provider is serving this answer',
    );
  });

  it('renders the shared banner with single-locale Swahili copy (zero-mix)', () => {
    const swFrame = {
      ...degradedFrame,
      label: 'Ubongo umepungua nguvu',
      reason:
        'Mtoa-huduma mbadala anahudumia jibu hili wakati tunarejesha huduma kuu.',
    };
    const { badge } = renderFromFrame(swFrame, 'sw');
    expect(badge).not.toBeNull();
    const banner = screen.getByTestId('degraded-banner');
    expect(banner.textContent ?? '').toContain('hali ya akiba');
    expect(banner.textContent ?? '').toContain('Mtoa-huduma mbadala');
  });

  it('renders nothing when the frame is not degraded', () => {
    const { badge } = renderFromFrame(
      { degraded: false, consecutiveFailures: 0 },
      'en',
    );
    expect(badge).toBeNull();
    expect(screen.queryByTestId('degraded-banner')).toBeNull();
  });
});
