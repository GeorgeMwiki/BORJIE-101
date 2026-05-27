/**
 * FeedbackButton (Owner Cockpit) — behaviour smoke tests.
 *
 * Covers:
 *   1. Opens the modal and renders 5 rating buttons + send/cancel.
 *   2. Submitting with a valid rating + message calls the injected
 *      submitter and closes the modal.
 *   3. Submitting an empty message surfaces the inline error toast
 *      (the optimistic-close path) without calling the submitter.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FeedbackButton, type FeedbackSubmission } from '../FeedbackButton';

afterEach(() => {
  cleanup();
});

describe('FeedbackButton (Owner)', () => {
  it('opens the modal with five star buttons and the message textarea', () => {
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

  it('calls the injected submitter with rating + message and closes the modal', async () => {
    const submissions: FeedbackSubmission[] = [];
    const onSubmit = vi.fn(async (input: FeedbackSubmission) => {
      submissions.push(input);
    });
    render(<FeedbackButton lang="en" screenId="O-M-03" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('feedback-button-open'));
    fireEvent.click(screen.getByTestId('feedback-button-star-5'));
    fireEvent.change(screen.getByTestId('feedback-button-message'), {
      target: { value: 'Great onboarding experience.' },
    });
    fireEvent.click(screen.getByTestId('feedback-button-send'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.rating).toBe(5);
    expect(submissions[0]?.message).toBe('Great onboarding experience.');
    expect(submissions[0]?.screenId).toBe('O-M-03');
    // Modal should be closed on optimistic submit.
    expect(screen.queryByTestId('feedback-button-modal')).toBeNull();
  });

  it('refuses to submit when message is empty and surfaces an inline error', () => {
    const onSubmit = vi.fn();
    render(<FeedbackButton lang="sw" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('feedback-button-open'));
    fireEvent.click(screen.getByTestId('feedback-button-star-4'));
    // Leave the textarea empty.
    fireEvent.click(screen.getByTestId('feedback-button-send'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('feedback-button-error')).toBeTruthy();
  });
});
