/**
 * pickDeliverableChannel — a chat/tab-created reminder must land on a channel
 * that can ACTUALLY reach the owner, never a dead destination the dispatch
 * worker would terminally fail. These cases lock the resolution policy:
 * honour the owner's preferred channel when deliverable, else fall back to the
 * first channel with a real destination (email → sms → slack), else email.
 */

import { describe, it, expect } from 'vitest';
import { pickDeliverableChannel } from '../handlers/reminders.js';

type Contact = Parameters<typeof pickDeliverableChannel>[0];

function contact(partial: Partial<Contact>): Contact {
  return {
    tenantId: 't-1',
    ownerId: 'o-1',
    email: null,
    phone: null,
    slackHandle: null,
    preferredChannel: 'email',
    locale: 'en',
    timezone: 'Africa/Dar_es_Salaam',
    hasContactPrefRow: true,
    ...partial,
  };
}

describe('pickDeliverableChannel', () => {
  it('honours the preferred channel when it has a destination', () => {
    expect(
      pickDeliverableChannel(
        contact({ preferredChannel: 'sms', phone: '+255700000000', email: 'o@x.co' }),
      ),
    ).toBe('sms');
    expect(
      pickDeliverableChannel(
        contact({ preferredChannel: 'slack', slackHandle: '@owner', email: 'o@x.co' }),
      ),
    ).toBe('slack');
  });

  it('falls back to a DELIVERABLE channel when the preferred one has no destination', () => {
    // Prefers sms but no phone on file → falls back to the deliverable email.
    expect(
      pickDeliverableChannel(contact({ preferredChannel: 'sms', email: 'o@x.co' })),
    ).toBe('email');
    // Prefers email but only a phone is on file → sms.
    expect(
      pickDeliverableChannel(contact({ preferredChannel: 'email', phone: '+255700000000' })),
    ).toBe('sms');
  });

  it("maps a non-worker preferred channel ('whatsapp') to a deliverable one", () => {
    expect(
      pickDeliverableChannel(
        contact({ preferredChannel: 'whatsapp', slackHandle: '@owner' }),
      ),
    ).toBe('slack');
  });

  it('defaults to email when NOTHING is deliverable (worker logs the gap)', () => {
    expect(pickDeliverableChannel(contact({}))).toBe('email');
  });

  it('prefers email → sms → slack ordering when no preference is deliverable', () => {
    expect(
      pickDeliverableChannel(
        contact({
          preferredChannel: 'whatsapp',
          email: 'o@x.co',
          phone: '+255700000000',
          slackHandle: '@owner',
        }),
      ),
    ).toBe('email');
  });
});
