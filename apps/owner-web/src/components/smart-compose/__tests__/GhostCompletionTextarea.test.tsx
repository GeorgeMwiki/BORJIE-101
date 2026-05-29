/**
 * R-FUTURE-2 — textarea ghost-overlay behaviour smoke tests.
 *
 *   1. Renders the textarea + (initially empty) overlay.
 *   2. Suggestion appears in the overlay after the debounced fetch.
 *   3. Tab accepts the suggestion.
 *   4. Escape suppresses the suggestion (overlay clears).
 *   5. IME composition suppresses the suggestion while in flight.
 *   6. Hint text is bilingual (sw default, en honoured).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { GhostCompletionTextarea } from '../GhostCompletionTextarea';

function makeFetcher(suggestion: string) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, data: { suggestion } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  );
}

function Harness({
  initial = '',
  fetcher,
  language,
}: {
  initial?: string;
  fetcher?: typeof fetch;
  language?: 'sw' | 'en';
}) {
  const [value, setValue] = useState(initial);
  return (
    <GhostCompletionTextarea
      value={value}
      onChange={setValue}
      placeholder="hi"
      {...(fetcher ? { fetcher } : {})}
      {...(language ? { language } : {})}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GhostCompletionTextarea', () => {
  it('renders the textarea + overlay siblings', () => {
    render(<Harness />);
    expect(screen.getByTestId('ghost-textarea-input')).toBeTruthy();
    expect(screen.getByTestId('ghost-textarea-overlay')).toBeTruthy();
  });

  it('shows the suggestion in the overlay after the fetch resolves', async () => {
    const fetcher = makeFetcher(' this week');
    render(<Harness fetcher={fetcher} />);
    const ta = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-overlay').textContent).toContain(
        'this week',
      );
    });
  });

  it('Tab accepts the suggestion into the value', async () => {
    const fetcher = makeFetcher(' this week');
    render(<Harness fetcher={fetcher} />);
    const ta = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-overlay').textContent).toContain(
        'this week',
      );
    });
    fireEvent.keyDown(ta, { key: 'Tab' });
    expect(ta.value).toBe('cash flow this week');
  });

  it('Escape suppresses the overlay until next keystroke', async () => {
    const fetcher = makeFetcher(' this week');
    render(<Harness fetcher={fetcher} />);
    const ta = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-overlay').textContent).toContain(
        'this week',
      );
    });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.getByTestId('ghost-textarea-overlay').textContent).not.toContain(
      'this week',
    );
    // The hint disappears as well once suppressed.
    expect(screen.queryByTestId('ghost-textarea-hint')).toBeNull();
  });

  it('IME composition suppresses the suggestion mid-stream', async () => {
    const fetcher = makeFetcher(' this week');
    render(<Harness fetcher={fetcher} />);
    const ta = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-overlay').textContent).toContain(
        'this week',
      );
    });
    fireEvent.compositionStart(ta);
    expect(screen.getByTestId('ghost-textarea-overlay').textContent).not.toContain(
      'this week',
    );
    fireEvent.compositionEnd(ta, { data: '' });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-overlay').textContent).toContain(
        'this week',
      );
    });
  });

  it('renders bilingual hint (sw default + en honoured)', async () => {
    const swFetcher = makeFetcher(' this week');
    render(<Harness fetcher={swFetcher} />);
    const ta = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-hint').textContent).toContain(
        'Tab kukubali',
      );
    });
    cleanup();
    const enFetcher = makeFetcher(' this week');
    render(<Harness fetcher={enFetcher} language="en" />);
    const ta2 = screen.getByTestId('ghost-textarea-input') as HTMLTextAreaElement;
    fireEvent.change(ta2, { target: { value: 'cash flow' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ghost-textarea-hint').textContent).toContain(
        'Tab to accept',
      );
    });
  });
});
