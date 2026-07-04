/**
 * GATE (B4): the ui_prefill chip was a dead control.
 *
 * `AdminSuperpowerChips`' "Pre-fill form" chip publishes
 * `borjie:admin:form-prefill`, but admin-web shipped ZERO production
 * listeners for it (only the bus unit test listened). The brain
 * "promised to fill the form" and nothing happened.
 *
 * `AdminFormPrefillReceiver` (mounted always-on via `AdminSuperpowers`)
 * now consumes the event and writes each value into the target form via
 * `applyAdminFormPrefill`, mirroring owner-web's `SuperpowerListeners`.
 *
 * This gate asserts the observable effect end-to-end: mount the receiver,
 * publish the real bus event, and confirm the DOM form's fields actually
 * receive the values. It BITES: remove the receiver's `addEventListener`
 * (the dead-control regression) and the fields stay empty → RED.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AdminFormPrefillReceiver } from '@/components/superpowers/AdminSuperpowerChips';
import { publishAdminFormPrefill } from '@/components/superpowers/bus';

afterEach(cleanup);

describe('AdminFormPrefillReceiver (B4)', () => {
  it('fills the target form when a prefill event is published', () => {
    // A real admin form on the page, opted-in via data-prefill-form.
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form data-prefill-form="tenant-suspend-form">
         <input name="reason" />
         <textarea name="note"></textarea>
       </form>`,
    );

    render(<AdminFormPrefillReceiver />);

    publishAdminFormPrefill({
      formId: 'tenant-suspend-form',
      values: { reason: 'sanctions-match', note: 'freeze pending review' },
      submitOnAccept: false,
    });

    const reason = document.querySelector<HTMLInputElement>('[name="reason"]');
    const note = document.querySelector<HTMLTextAreaElement>('[name="note"]');
    expect(reason?.value).toBe('sanctions-match');
    expect(note?.value).toBe('freeze pending review');

    document.body.innerHTML = '';
  });

  it('is an honest no-op when no matching form is on the page', () => {
    render(<AdminFormPrefillReceiver />);
    // Should not throw with no target present.
    expect(() =>
      publishAdminFormPrefill({
        formId: 'nonexistent-form',
        values: { reason: 'x' },
        submitOnAccept: false,
      }),
    ).not.toThrow();
  });
});
