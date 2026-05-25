import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blackboard } from '../blackboard/Blackboard';
import { AdaptiveRenderer } from '../generative-ui/AdaptiveRenderer';
import type { AdaptiveMessageMetadata } from '../generative-ui/types';

/**
 * Integration test: a Blackboard containing a rent-affordability calculator
 * renders interactively, the same way the four BORJIE apps mount it.
 */
describe('Blackboard + RentAffordabilityCalculator integration', () => {
  it('renders the calculator inside the board and reacts to input changes', () => {
    const meta: AdaptiveMessageMetadata = {
      uiBlocks: [
        {
          id: 'c1',
          type: 'rent_affordability_calculator',
          position: 'below',
          defaultRent: 25000,
          defaultIncome: 100000,
          currency: 'KES',
        },
      ],
    };
    render(
      <Blackboard language="en" conceptTitle="Rent Affordability Ratio">
        <AdaptiveRenderer metadata={meta} language="en" />
      </Blackboard>,
    );

    // Board shell
    expect(screen.getByTestId('blackboard')).toBeInTheDocument();
    expect(screen.getByTestId('blackboard-concept').textContent).toBe('Rent Affordability Ratio');
    // Interactive calculator rendered inside canvas
    expect(screen.getByTestId('rent-affordability-calculator')).toHaveAttribute('data-status', 'green');

    // Push rent above 40% — expect red
    const rentInput = screen.getByTestId('rent-input') as HTMLInputElement;
    fireEvent.change(rentInput, { target: { value: '60000' } });
    expect(screen.getByTestId('rent-affordability-calculator')).toHaveAttribute('data-status', 'red');
  });
});
