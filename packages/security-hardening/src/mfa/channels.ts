/**
 * MFA channel adapter port.
 *
 * Channel = the way an OTP/challenge actually reaches the user (push
 * notification, SMS, voice, email). The port leaves the wiring to ops:
 * for BORJIE Tanzania/Kenya the SMS adapter is typically backed by
 * Africa's Talking or the M-Pesa B2C SMS channel; for diaspora it's
 * Twilio Verify or a push to the mobile app.
 *
 * We define the port + a deterministic in-memory adapter for tests.
 */

import type { MFAChannel } from '../types.js';

export interface MFAChannelDeliverInput {
  readonly channel: MFAChannel;
  readonly userId: string;
  readonly tenantId: string;
  readonly to: string;
  readonly code: string;
}

export interface MFAChannelAdapter {
  deliver(input: MFAChannelDeliverInput): Promise<{ readonly delivered: boolean }>;
}

export interface InMemoryDelivery {
  readonly channel: MFAChannel;
  readonly userId: string;
  readonly tenantId: string;
  readonly to: string;
  readonly code: string;
  readonly at: number;
}

export interface InMemoryAdapter extends MFAChannelAdapter {
  readonly deliveries: ReadonlyArray<InMemoryDelivery>;
  clear(): void;
}

export function createInMemoryAdapter(
  now: () => number = Date.now,
): InMemoryAdapter {
  const store: InMemoryDelivery[] = [];
  return {
    get deliveries() {
      return store.slice();
    },
    async deliver(input) {
      store.push({ ...input, at: now() });
      return { delivered: true };
    },
    clear() {
      store.length = 0;
    },
  };
}
