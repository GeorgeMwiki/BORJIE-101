import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  FivePsOperatorRiskWheel,
  computeFivePs,
} from '../generative-ui/blocks/5ps-operator-risk-wheel';
import type { FivePsRiskWheelBlock } from '../generative-ui/types';

describe('computeFivePs', () => {
  it('sums shares to 1.0 when total > 0', () => {
    const b = computeFivePs({
      paymentHistory: 10,
      assetFit: 20,
      purpose: 30,
      person: 20,
      protection: 20,
    });
    const total = b.dimensions.reduce((acc, d) => acc + d.share, 0);
    expect(total).toBeCloseTo(1);
  });

  it('identifies the dominant dimension', () => {
    const b = computeFivePs({
      paymentHistory: 10,
      assetFit: 20,
      purpose: 90,
      person: 20,
      protection: 20,
    });
    expect(b.dominant.key).toBe('purpose');
    expect(b.dominant.score).toBe(90);
  });

  it('returns zero shares when all scores are zero', () => {
    const b = computeFivePs({
      paymentHistory: 0,
      assetFit: 0,
      purpose: 0,
      person: 0,
      protection: 0,
    });
    expect(b.dimensions.every((d) => d.share === 0)).toBe(true);
    expect(b.total).toBe(0);
  });
});

describe('FivePsOperatorRiskWheel component', () => {
  const block: FivePsRiskWheelBlock = {
    id: 'w1',
    type: 'five_ps_operator_risk_wheel',
    position: 'below',
    title: '5 Ps of operator risk',
    scores: {
      paymentHistory: 70,
      assetFit: 85,
      purpose: 60,
      person: 80,
      protection: 55,
    },
    overallRating: 'B',
  };

  it('renders and exposes rating + dominant dimension', () => {
    render(<FivePsOperatorRiskWheel block={block} language="en" />);
    const wheel = screen.getByTestId('five-ps-operator-risk-wheel');
    expect(wheel).toHaveAttribute('data-rating', 'B');
    expect(wheel).toHaveAttribute('data-dominant', 'assetFit');
    expect(screen.getByTestId('five-ps-dominant').textContent).toContain('Asset fit');
  });
});
