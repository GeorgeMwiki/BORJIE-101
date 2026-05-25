/**
 * inngest-client tests — env-gating, factory fallback when package
 * absent, signing-key resolver.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createInngestClient,
  isInngestEnabled,
  getInngestSigningKey,
  AGENCY_RUN_EVENT,
  INNGEST_APP_ID,
} from '../inngest-client.js';

describe('inngest-client — env gating', () => {
  const originalEventKey = process.env.INNGEST_EVENT_KEY;
  const originalSigningKey = process.env.INNGEST_SIGNING_KEY;

  beforeEach(() => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
  });

  afterEach(() => {
    if (originalEventKey !== undefined) {
      process.env.INNGEST_EVENT_KEY = originalEventKey;
    } else {
      delete process.env.INNGEST_EVENT_KEY;
    }
    if (originalSigningKey !== undefined) {
      process.env.INNGEST_SIGNING_KEY = originalSigningKey;
    } else {
      delete process.env.INNGEST_SIGNING_KEY;
    }
  });

  it('is disabled when INNGEST_EVENT_KEY is absent', () => {
    expect(isInngestEnabled()).toBe(false);
  });

  it('is enabled when INNGEST_EVENT_KEY is set', () => {
    process.env.INNGEST_EVENT_KEY = 'evt_local';
    expect(isInngestEnabled()).toBe(true);
  });

  it('forceEnabled overrides the env check', () => {
    expect(isInngestEnabled({ forceEnabled: true })).toBe(true);
    process.env.INNGEST_EVENT_KEY = 'evt_local';
    expect(isInngestEnabled({ forceEnabled: false })).toBe(false);
  });

  it('createInngestClient returns null when disabled', async () => {
    const client = await createInngestClient();
    expect(client).toBeNull();
  });

  it('createInngestClient returns an Inngest client when package installed + enabled', async () => {
    // 2026-05-24: inngest is now a real dep of api-gateway (per the
    // durable-execution W4.5 wave). When forced enabled + key supplied,
    // the factory returns a live Inngest app instance. The earlier
    // assertion (`expect(client).toBeNull()`) tested the pre-install
    // optional-load path and is no longer applicable.
    const client = await createInngestClient({
      forceEnabled: true,
      eventKey: 'evt_local',
    });
    expect(client).not.toBeNull();
    expect(typeof (client as { send?: unknown })?.send).toBe('function');
  });

  it('getInngestSigningKey returns null when env unset', () => {
    expect(getInngestSigningKey()).toBeNull();
  });

  it('getInngestSigningKey reads from env when set', () => {
    process.env.INNGEST_SIGNING_KEY = 'signkey_xyz';
    expect(getInngestSigningKey()).toBe('signkey_xyz');
  });
});

describe('inngest-client — constants', () => {
  it('exposes a stable agency-run event name', () => {
    expect(AGENCY_RUN_EVENT).toBe('agency/run.requested');
  });
  it('exposes a stable app id', () => {
    expect(INNGEST_APP_ID).toBe('borjie-api-gateway');
  });
});
