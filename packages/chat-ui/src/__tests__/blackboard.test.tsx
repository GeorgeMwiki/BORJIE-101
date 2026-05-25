import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blackboard } from '../blackboard/Blackboard';

describe('Blackboard', () => {
  it('renders the empty state when no children are provided', () => {
    render(<Blackboard language="en" />);
    expect(screen.getByTestId('blackboard')).toBeInTheDocument();
    expect(screen.getByTestId('blackboard-empty')).toBeInTheDocument();
  });

  it('displays the concept title when given', () => {
    render(<Blackboard language="en" conceptTitle="Rent Affordability" />);
    expect(screen.getByTestId('blackboard-concept').textContent).toBe('Rent Affordability');
  });

  it('renders children inside the canvas when given', () => {
    render(
      <Blackboard language="en">
        <div data-testid="child">block content</div>
      </Blackboard>,
    );
    expect(screen.queryByTestId('blackboard-empty')).toBeNull();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('invokes onClear when the clear button is clicked', () => {
    const onClear = vi.fn();
    render(<Blackboard language="en" onClear={onClear} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('accepts freeform notes in the textarea', () => {
    render(<Blackboard language="en" />);
    const notes = screen.getByTestId('blackboard-notes') as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'A tenant earning 100k can afford 33k rent' } });
    expect(notes.value).toBe('A tenant earning 100k can afford 33k rent');
  });
});
