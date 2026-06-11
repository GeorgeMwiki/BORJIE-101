/**
 * Tests for the DEFAULT-ON config-driven routing kill-switch.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isRoutingConfigEnabled } from '../feature-flag.js';

afterEach(() => {
  delete process.env.BORJIE_LLM_ROUTING_CONFIG;
});

describe('isRoutingConfigEnabled (default-on kill-switch)', () => {
  it('is ON when the env var is unset (default-on)', () => {
    delete process.env.BORJIE_LLM_ROUTING_CONFIG;
    expect(isRoutingConfigEnabled()).toBe(true);
  });

  it('is ON for an empty string', () => {
    process.env.BORJIE_LLM_ROUTING_CONFIG = '';
    expect(isRoutingConfigEnabled()).toBe(true);
  });

  it('is ON for "on" / "1" / "true"', () => {
    for (const v of ['on', '1', 'true', 'yes', 'enabled']) {
      process.env.BORJIE_LLM_ROUTING_CONFIG = v;
      expect(isRoutingConfigEnabled()).toBe(true);
    }
  });

  it('is OFF only for explicit off-tokens', () => {
    for (const v of ['0', 'false', 'off', 'no', 'OFF', ' False ']) {
      process.env.BORJIE_LLM_ROUTING_CONFIG = v;
      expect(isRoutingConfigEnabled()).toBe(false);
    }
  });
});
