import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  RoyaltyAffordabilityCalculator,
  classifyAffordability,
} from '../generative-ui/blocks/royalty-affordability-calculator';
import type { RoyaltyAffordabilityCalculatorBlock } from '../generative-ui/types';

describe('classifyAffordability', () => {
  it('classifies 30% as green (affordable)', () => {
    const r = classifyAffordability(30, 100);
    expect(r.status).toBe('green');
    expect(r.ratio).toBeCloseTo(0.3);
  });

  it('classifies 33% as green (boundary)', () => {
    expect(classifyAffordability(33, 100).status).toBe('green');
  });

  it('classifies 38% as yellow (tight)', () => {
    expect(classifyAffordability(38, 100).status).toBe('yellow');
  });

  it('classifies 40% as yellow (boundary)', () => {
    expect(classifyAffordability(40, 100).status).toBe('yellow');
  });

  it('classifies 50% as red (unaffordable)', () => {
    expect(classifyAffordability(50, 100).status).toBe('red');
  });

  it('handles zero income gracefully', () => {
    const r = classifyAffordability(1000, 0);
    expect(r.status).toBe('red');
    expect(r.ratio).toBe(0);
  });
});

describe('RoyaltyAffordabilityCalculator', () => {
  const base: RoyaltyAffordabilityCalculatorBlock = {
    id: 'b1',
    type: 'royalty_affordability_calculator',
    position: 'below',
    defaultRoyalty: 25000,
    defaultIncome: 100000,
    currency: 'KES',
  };

  it('renders with defaults and shows green status', () => {
    render(<RoyaltyAffordabilityCalculator block={base} language="en" />);
    expect(screen.getByTestId('royalty-affordability-calculator')).toHaveAttribute('data-status', 'green');
    expect(screen.getByTestId('royalty-ratio').textContent).toBe('25%');
  });

  it('updates status when the user changes royalty', () => {
    render(<RoyaltyAffordabilityCalculator block={base} language="en" />);
    const royaltyInput = screen.getByTestId('royalty-input') as HTMLInputElement;
    fireEvent.change(royaltyInput, { target: { value: '50000' } });
    expect(screen.getByTestId('royalty-affordability-calculator')).toHaveAttribute('data-status', 'red');
  });

  it('shows yellow status at 35% ratio', () => {
    render(<RoyaltyAffordabilityCalculator block={base} language="en" />);
    const royaltyInput = screen.getByTestId('royalty-input') as HTMLInputElement;
    fireEvent.change(royaltyInput, { target: { value: '35000' } });
    expect(screen.getByTestId('royalty-affordability-calculator')).toHaveAttribute('data-status', 'yellow');
  });
});
