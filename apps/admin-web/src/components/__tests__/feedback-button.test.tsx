/**
 * FeedbackButton (Admin Console) — behaviour smoke tests.
 *
 * Covers:
 *   1. Opens the modal and renders the rating row + textarea + buttons.
 *   2. Submitting a valid form forwards the payload to the injected
 *      submitter and closes the modal.
 *   3. Empty message + rating triggers the inline error toast without
 *      calling the submitter.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FeedbackButton, type FeedbackSubmission } from '../FeedbackButton';

afterEach(() => {
  cleanup();
});

describe('FeedbackButton (Admin)', () => {
  it('opens the modal with all five star buttons and the message textarea', () => {
    render(<FeedbackButton lang="sw" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('feedback-button-open'));
    expect(screen.getByTestId('feedback-button-modal')).toBeTruthy();
    for (let star = 1; star <= 5; star += 1) {
      expect(screen.getByTestId(`feedback-button-star-${star}`)).toBeTruthy();
    }
    expect(screen.getByTestId('feedback-button-message')).toBeTruthy();
    expect(screen.getByTestId('feedback-button-send')).toBeTruthy();
    expect(screen.getByTestId('feedback-button-cancel')).toBeTruthy();
  });

  it('calls the injected submitter with the full payload and closes the modal', async () => {
    const submissions: FeedbackSubmission[] = [];
    const onSubmit = vi.fn(async (input: FeedbackSubmission) => {
      submissions.push(input);
    });
    render(
      <FeedbackButton
        lang="en"
        screenId="A-OPS-12"
        sessionContext={{ cohort: 'pilot-tz-may-2026' }}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('feedback-button-open'));
    fireEvent.click(screen.getByTestId('feedback-button-star-4'));
    fireEvent.change(screen.getByTestId('feedback-button-message'), {
      target: { value: 'Faster than expected on cheap android.' },
    });
    fireEvent.click(screen.getByTestId('feedback-button-send'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.rating).toBe(4);
    expect(submissions[0]?.message).toContain('cheap android');
    expect(submissions[0]?.screenId).toBe('A-OPS-12');
    expect(submissions[0]?.sessionContext?.cohort).toBe('pilot-tz-may-2026');
    expect(screen.queryByTestId('feedback-button-modal')).toBeNull();
  });

  it('refuses to submit when message is empty and surfaces an inline error', () => {
    const onSubmit = vi.fn();
    render(<FeedbackButton lang="sw" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('feedback-button-open'));
    fireEvent.click(screen.getByTestId('feedback-button-star-2'));
    fireEvent.click(screen.getByTestId('feedback-button-send'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('feedback-button-error')).toBeTruthy();
  });
});
