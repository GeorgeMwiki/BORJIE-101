import { describe, it, expect } from 'vitest';

import { createSecurityHardening } from '../index.js';

describe('createSecurityHardening one-stop factory', () => {
  it('builds a wired-up bundle of every subsystem we own', () => {
    const sh = createSecurityHardening({
      headersEnv: 'production',
      defaultRateLimit: {
        algorithm: 'fixedWindow',
        limit: 100,
        windowMs: 60_000,
      },
      stepUpFreshnessMs: 60_000,
    });
    expect(typeof sh.headersMiddleware).toBe('function');
    expect(sh.defaultRateLimiter?.algorithm).toBe('fixedWindow');
    expect(typeof sh.stepUp.require).toBe('function');
    expect(typeof sh.anomalyDetector.scoreLogin).toBe('function');
    expect(typeof sh.stuffingDetector.recordAuthAttempt).toBe('function');
  });

  it('omits defaultRateLimiter when no defaultRateLimit is configured', () => {
    const sh = createSecurityHardening({ headersEnv: 'development' });
    expect(sh.defaultRateLimiter).toBeUndefined();
  });
});
