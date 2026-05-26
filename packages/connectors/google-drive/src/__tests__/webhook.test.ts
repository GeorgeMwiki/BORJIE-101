import { describe, it, expect } from 'vitest';
import { receiveDriveWebhook } from '../ingest/webhook-receiver.js';
import type { ConnectorLogger } from '../types.js';

const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('receiveDriveWebhook', () => {
  it('returns unsupported with an informative reason', () => {
    const result = receiveDriveWebhook('{}', 'channel-id', {
      logger: noopLogger,
      tenantId: 'tenant_a',
    });
    expect(result.outcome).toBe('unsupported');
    expect(result.reason).toMatch(/changes polling/i);
  });

  it('handles a missing channel header', () => {
    const result = receiveDriveWebhook('{}', null, {
      logger: noopLogger,
      tenantId: 'tenant_a',
    });
    expect(result.outcome).toBe('unsupported');
  });
});
