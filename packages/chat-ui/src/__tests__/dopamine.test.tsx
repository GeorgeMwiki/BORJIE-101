/**
 * Dopamine Design tests.
 */

import React from 'react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfettiTrigger } from '../dopamine/confetti-trigger';
import { AchievementBadge } from '../dopamine/achievement-badge';
import { StreakCounter } from '../dopamine/streak-counter';
import { LevelProgressBar } from '../dopamine/level-progress-bar';
import type {
  AchievementBadgeData,
  StreakState,
  LevelState,
} from '../dopamine/types';

afterEach(() => cleanup());

function mockMatchMedia(prefersReduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? prefersReduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ConfettiTrigger', () => {
  it('renders nothing when inactive', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ConfettiTrigger
        active={false}
        kind="tenant-signed-lease"
        tenantId="t-1"
        userId="u-1"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders confetti particles when active and motion allowed', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ConfettiTrigger
        active={true}
        kind="tenant-on-time-payment"
        tenantId="t-1"
        userId="u-1"
        particleCount={10}
      />,
    );
    const particles = container.querySelectorAll('[data-particle-id]');
    expect(particles.length).toBe(10);
  });

  it('renders accessible status when reduced motion', () => {
    mockMatchMedia(true);
    render(
      <ConfettiTrigger
        active={true}
        kind="tender-awarded"
        tenantId="t-1"
        userId="u-1"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('tender-awarded');
  });

  it('tags with tenant+user+kind scope', () => {
    mockMatchMedia(false);
    const { container } = render(
      <ConfettiTrigger
        active={true}
        kind="maintenance-case-resolved"
        tenantId="t-xyz"
        userId="u-abc"
      />,
    );
    const scope = container.querySelector('[data-dopamine-scope]');
    expect(scope?.getAttribute('data-dopamine-scope')).toBe(
      't-xyz-u-abc-maintenance-case-resolved',
    );
  });
});

describe('AchievementBadge', () => {
  const baseBadge: AchievementBadgeData = {
    id: 'b-1',
    tenantId: 't-1',
    userId: 'u-1',
    titleEn: 'First 100 Leases',
    titleSw: 'Mikataba 100 ya kwanza',
    descriptionEn: 'Signed 100 leases',
    descriptionSw: 'Umesaini mikataba 100',
    tier: 'gold',
    earnedAt: '2026-04-19T10:00:00Z',
    iconKey: 'lease',
  };

  it('renders English title by default', () => {
    render(<AchievementBadge badge={baseBadge} />);
    expect(screen.getByText('First 100 Leases')).toBeInTheDocument();
  });

  it('renders Swahili title when locale=sw', () => {
    render(<AchievementBadge badge={baseBadge} locale="sw" />);
    expect(screen.getByText('Mikataba 100 ya kwanza')).toBeInTheDocument();
  });

  it('shows grayscale when not earned', () => {
    const notYet: AchievementBadgeData = { ...baseBadge, earnedAt: null };
    const { container } = render(<AchievementBadge badge={notYet} />);
    const root = container.querySelector('[data-dopamine-earned]');
    expect(root?.getAttribute('data-dopamine-earned')).toBe('false');
  });

  it('tags data attrs with tenant+user+tier', () => {
    const { container } = render(<AchievementBadge badge={baseBadge} />);
    const root = container.querySelector('[data-dopamine-tenant]');
    expect(root?.getAttribute('data-dopamine-tenant')).toBe('t-1');
    expect(root?.getAttribute('data-dopamine-user')).toBe('u-1');
    expect(root?.getAttribute('data-dopamine-tier')).toBe('gold');
  });
});

describe('StreakCounter', () => {
  const baseStreak: StreakState = {
    tenantId: 't-1',
    userId: 'u-1',
    streakKey: 'on-time-payments',
    currentValue: 12,
    lastIncrementAt: '2026-04-19T10:00:00Z',
    personalBest: 12,
  };

  it('marks personal best when current equals best', () => {
    const { container } = render(
      <StreakCounter
        state={baseStreak}
        labelEn="On-time payments"
        labelSw="Malipo kwa wakati"
      />,
    );
    const root = container.querySelector('[data-personal-best]');
    expect(root?.getAttribute('data-personal-best')).toBe('true');
  });

  it('does not mark personal best when below record', () => {
    const belowBest = { ...baseStreak, currentValue: 5, personalBest: 12 };
    const { container } = render(
      <StreakCounter
        state={belowBest}
        labelEn="On-time payments"
        labelSw="Malipo kwa wakati"
      />,
    );
    const root = container.querySelector('[data-personal-best]');
    expect(root?.getAttribute('data-personal-best')).toBe('false');
  });
});

describe('LevelProgressBar', () => {
  const bronze: LevelState = {
    tenantId: 't-1',
    userId: 'u-1',
    xp: 250,
    tier: 'bronze',
    xpToNextTier: 750,
  };

  it('renders bronze label', () => {
    render(<LevelProgressBar state={bronze} />);
    expect(screen.getByText('Bronze')).toBeInTheDocument();
  });

  it('renders Swahili labels', () => {
    render(<LevelProgressBar state={bronze} locale="sw" />);
    expect(screen.getByText('Shaba')).toBeInTheDocument();
  });

  it('clamps progress between 0 and 100', () => {
    const overflow: LevelState = { ...bronze, xp: 10000, xpToNextTier: 0 };
    const { container } = render(<LevelProgressBar state={overflow} />);
    const bar = container.querySelector('[role="progressbar"]');
    const val = Number(bar?.getAttribute('aria-valuenow'));
    expect(val).toBeLessThanOrEqual(100);
    expect(val).toBeGreaterThanOrEqual(0);
  });
});
