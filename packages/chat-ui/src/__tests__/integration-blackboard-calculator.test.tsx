import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blackboard } from '../blackboard/Blackboard';
import { AdaptiveRenderer } from '../generative-ui/AdaptiveRenderer';
import type { AdaptiveMessageMetadata } from '../generative-ui/types';

/**
 * Integration test: a Blackboard containing a royalty-affordability calculator
 * renders interactively, the same way the four BORJIE apps mount it.
 */
describe('Blackboard + RoyaltyAffordabilityCalculator integration', () => {
  it('renders the calculator inside the board and reacts to input changes', () => {
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        {
          id: 'c1',
          type: 'royalty_affordability_calculator',
          position: 'below',
          defaultRoyalty: 25000,
          defaultIncome: 100000,
          currency: 'KES',
        },
      ],
    };
    render(
      <Blackboard language="en" conceptTitle="Royalty Affordability Ratio">
        <AdaptiveRenderer metadata={meta} language="en" />
      </Blackboard>,
    );

    // Board shell
    expect(screen.getByTestId('blackboard')).toBeInTheDocument();
    expect(screen.getByTestId('blackboard-concept').textContent).toBe('Royalty Affordability Ratio');
    // Interactive calculator rendered inside canvas
    expect(screen.getByTestId('royalty-affordability-calculator')).toHaveAttribute('data-status', 'green');

    // Push royalty above 40% — expect red
    const royaltyInput = screen.getByTestId('royalty-input') as HTMLInputElement;
    fireEvent.change(royaltyInput, { target: { value: '60000' } });
    expect(screen.getByTestId('royalty-affordability-calculator')).toHaveAttribute('data-status', 'red');
  });
});
