import { describe, expect, it, vi } from 'vitest';
import { createLogSink } from '../sinks/log-sink.js';
import type { Trigger } from '@borjie/user-context-store';

describe('createLogSink', () => {
  it('emits via logger.info', () => {
    const info = vi.fn();
    const sink = createLogSink({
      logger: { info, warn: () => {} },
    });
    const trigger: Trigger = {
      id: 'bn_abc1234567',
      kind: 'tenant.lease_ending_30d',
      urgency: 5,
      summary: 'Lease ends in 10 days',
      suggestedAction: 'Sign renewal',
      suggestedPromptForChat: 'Help me renew',
      triggeringEvidence: [{ kind: 'lease', id: 'l1' }],
    };
    sink.emit({ tenantId: 't1', userId: 'u1', role: 'tenant', trigger });
    expect(info).toHaveBeenCalledTimes(1);
    const payload = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['triggerId']).toBe('bn_abc1234567');
    expect(payload['urgency']).toBe(5);
  });
});
