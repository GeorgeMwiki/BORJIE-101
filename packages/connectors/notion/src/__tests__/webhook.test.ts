import { describe, it, expect } from 'vitest';
import { receiveNotionWebhook } from '../ingest/webhook-receiver.js';
import type { ConnectorLogger } from '../types.js';

const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('receiveNotionWebhook', () => {
  it('returns unsupported with an informative reason', () => {
    const result = receiveNotionWebhook('{"foo":"bar"}', null, {
      logger: noopLogger,
      tenantId: 'tenant_a',
    });
    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toMatch(/no native webhook/i);
  });

  it('still returns unsupported when a signature header is present', () => {
    const result = receiveNotionWebhook('{}', 'sha256=abc', {
      logger: noopLogger,
      tenantId: 'tenant_a',
    });
    expect(result.outcome).toBe('unsupported');
  });
});
