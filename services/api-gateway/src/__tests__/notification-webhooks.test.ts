/**
 * Notification webhook signature verification (SCAFFOLDED 8 + NEW 21)
 *
 * DA1 MEDIUM addition: end-to-end assertion that the router emits the
 * canonical `{ success: false, error: { code, message } }` envelope on
 * signature rejection — not the legacy `{ error: { code, message } }`
 * shape. Single envelope means SDK callers can write one parser.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  __internal,
  createNotificationWebhookRouter,
} from '../routes/notification-webhooks.router.js';

describe('notification-webhooks signature verification', () => {
  const body = '{"ok":true}';

  describe('africastalking', () => {
    const secret = 'at-secret';
    beforeAll(() => {
      process.env.AFRICASTALKING_WEBHOOK_SECRET = secret;
    });
    afterAll(() => {
      delete process.env.AFRICASTALKING_WEBHOOK_SECRET;
    });

    it('accepts a valid HMAC-SHA256 hex signature', () => {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      expect(__internal.verifyAfricasTalking(body, sig)).toBe(true);
    });

    it('rejects a forged signature', () => {
      const sig = createHmac('sha256', 'wrong').update(body).digest('hex');
      expect(__internal.verifyAfricasTalking(body, sig)).toBe(false);
    });

    it('rejects missing signature', () => {
      expect(__internal.verifyAfricasTalking(body, undefined)).toBe(false);
    });
  });

  describe('meta', () => {
    const secret = 'meta-secret';
    beforeAll(() => {
      process.env.META_APP_SECRET = secret;
    });
    afterAll(() => {
      delete process.env.META_APP_SECRET;
    });

    it('accepts the sha256=<hex> form', () => {
      const hex = createHmac('sha256', secret).update(body).digest('hex');
      expect(__internal.verifyMeta(body, `sha256=${hex}`)).toBe(true);
    });

    it('rejects missing prefix', () => {
      const hex = createHmac('sha256', secret).update(body).digest('hex');
      expect(__internal.verifyMeta(body, hex)).toBe(false);
    });
  });

  describe('normalization', () => {
    it('normalizes africastalking status strings', () => {
      expect(__internal.normalizeAfricasTalkingStatus({ status: 'Success' })).toBe('delivered');
      expect(__internal.normalizeAfricasTalkingStatus({ status: 'Failed' })).toBe('failed');
      expect(__internal.normalizeAfricasTalkingStatus({ status: 'Queued' })).toBe('unknown');
    });

    it('normalizes twilio status strings', () => {
      expect(__internal.normalizeTwilioStatus({ MessageStatus: 'delivered' })).toBe('delivered');
      expect(__internal.normalizeTwilioStatus({ MessageStatus: 'undelivered' })).toBe('failed');
      expect(__internal.normalizeTwilioStatus({ SmsStatus: 'queued' })).toBe('sent');
    });
  });
});

// ---------------------------------------------------------------------------
// DA1 MEDIUM: canonical error-envelope on signature rejection
// ---------------------------------------------------------------------------
// Goal: prove the 401 INVALID_SIGNATURE response uses the canonical
// `{ success: false, error: { code, message }, meta: { timestamp } }`
// envelope from `utils/error-response.ts`. Prior router emitted the
// legacy `{ error: { ... } }` shape which forced SDK clients to write
// a second parser path.

describe('notification-webhooks — canonical error envelope on rejection', () => {
  const noop = async () => undefined;

  beforeAll(() => {
    process.env.AFRICASTALKING_WEBHOOK_SECRET = 'at-secret';
    process.env.META_APP_SECRET = 'meta-secret';
    process.env.TWILIO_AUTH_TOKEN = 'twilio-secret';
    process.env.TWILIO_WEBHOOK_URL = 'https://test.borjie.com/webhooks/notifications/twilio';
  });
  afterAll(() => {
    delete process.env.AFRICASTALKING_WEBHOOK_SECRET;
    delete process.env.META_APP_SECRET;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WEBHOOK_URL;
  });

  it('africastalking rejects forged signature with canonical envelope', async () => {
    const app = createNotificationWebhookRouter({ onDeliveryStatus: noop });
    const res = await app.request('/africastalking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-at-signature': 'not-a-real-sig' },
      body: '{"ok":true}',
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success?: boolean;
      error?: { code?: string; message?: string };
      meta?: { timestamp?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_SIGNATURE');
    expect(body.error?.message).toMatch(/invalid signature/i);
    expect(body.meta?.timestamp).toBeTypeOf('string');
  });

  it('meta rejects missing prefix with canonical envelope', async () => {
    const app = createNotificationWebhookRouter({ onDeliveryStatus: noop });
    const res = await app.request('/meta', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'deadbeef',
      },
      body: '{"entry":[{"id":"x"}]}',
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success?: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_SIGNATURE');
  });

  it('twilio rejects forged signature with canonical envelope', async () => {
    const app = createNotificationWebhookRouter({ onDeliveryStatus: noop });
    const res = await app.request('/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'not-a-real-sig',
      },
      body: 'From=%2B254700000000&To=%2B254700000001&MessageStatus=delivered',
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success?: boolean;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVALID_SIGNATURE');
  });
});
