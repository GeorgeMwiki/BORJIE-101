import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdaptiveRenderer } from '../generative-ui/AdaptiveRenderer';
import type { AdaptiveMessageMetadata } from '../generative-ui/types';

describe('AdaptiveRenderer', () => {
  it('returns null with no blocks', () => {
    const { container } = render(<AdaptiveRenderer language="en" />);
    expect(container.firstChild).toBeNull();
  });

  it('dispatches rent_affordability_calculator to the right block', () => {
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        {
          id: 'b1',
          type: 'rent_affordability_calculator',
          position: 'below',
          defaultRent: 20000,
          defaultIncome: 80000,
          currency: 'KES',
        },
      ],
    };
    render(<AdaptiveRenderer metadata={meta} language="en" />);
    expect(screen.getByTestId('rent-affordability-calculator')).toBeInTheDocument();
  });

  it('dispatches five_ps_tenancy_risk_wheel to the wheel block', () => {
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        {
          id: 'w1',
          type: 'five_ps_tenancy_risk_wheel',
          position: 'below',
          title: '5 Ps',
          scores: {
            paymentHistory: 60,
            propertyFit: 70,
            purpose: 80,
            person: 50,
            protection: 40,
          },
          overallRating: 'B',
        },
      ],
    };
    render(<AdaptiveRenderer metadata={meta} language="en" />);
    expect(screen.getByTestId('five-ps-tenancy-risk-wheel')).toBeInTheDocument();
  });

  it('fires onQuizAnswer with correctness flag', () => {
    const onQuizAnswer = vi.fn();
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        {
          id: 'q1',
          type: 'quiz',
          position: 'below',
          question: 'What is the safe rent-to-income ceiling?',
          options: [
            { id: 'A', label: '50%', isCorrect: false },
            { id: 'B', label: '33%', isCorrect: true },
          ],
          difficulty: 'beginner',
        },
      ],
    };
    render(<AdaptiveRenderer metadata={meta} language="en" onQuizAnswer={onQuizAnswer} />);
    fireEvent.click(screen.getByText('33%'));
    expect(onQuizAnswer).toHaveBeenCalledWith('q1', 'B', true);
  });

  it('handles unknown block types without crashing', () => {
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        { id: 'x1', type: 'not_a_real_type', position: 'below' } as any,
      ],
    };
    render(<AdaptiveRenderer metadata={meta} language="en" />);
    expect(screen.getByTestId('unknown-block')).toBeInTheDocument();
  });
});
