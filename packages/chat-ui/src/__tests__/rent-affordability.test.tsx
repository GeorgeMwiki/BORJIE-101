import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  RentAffordabilityCalculator,
  classifyAffordability,
} from '../generative-ui/blocks/rent-affordability-calculator';
import type { RentAffordabilityCalculatorBlock } from '../generative-ui/types';

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

describe('RentAffordabilityCalculator', () => {
  const base: RentAffordabilityCalculatorBlock = {
    id: 'b1',
    type: 'rent_affordability_calculator',
    position: 'below',
    defaultRent: 25000,
    defaultIncome: 100000,
    currency: 'KES',
  };

  it('renders with defaults and shows green status', () => {
    render(<RentAffordabilityCalculator block={base} language="en" />);
    expect(screen.getByTestId('rent-affordability-calculator')).toHaveAttribute('data-status', 'green');
    expect(screen.getByTestId('rent-ratio').textContent).toBe('25%');
  });

  it('updates status when the user changes rent', () => {
    render(<RentAffordabilityCalculator block={base} language="en" />);
    const rentInput = screen.getByTestId('rent-input') as HTMLInputElement;
    fireEvent.change(rentInput, { target: { value: '50000' } });
    expect(screen.getByTestId('rent-affordability-calculator')).toHaveAttribute('data-status', 'red');
  });

  it('shows yellow status at 35% ratio', () => {
    render(<RentAffordabilityCalculator block={base} language="en" />);
    const rentInput = screen.getByTestId('rent-input') as HTMLInputElement;
    fireEvent.change(rentInput, { target: { value: '35000' } });
    expect(screen.getByTestId('rent-affordability-calculator')).toHaveAttribute('data-status', 'yellow');
  });
});
