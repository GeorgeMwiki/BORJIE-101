/**
 * buildBatch test — pure shape contract for the wire envelope.
 */

import { describe, expect, it } from 'vitest';
import { buildBatch } from '../capture-client/capture-client.js';
import type { CaptureEvent } from '../types.js';

describe('buildBatch', () => {
  it('wraps events with the session scope', () => {
    const events: ReadonlyArray<CaptureEvent> = [
      {
        kind: 'ui_state',
        emittedAt: '2026-01-01T00:00:00.000Z',
        sessionId: 'sess_1',
        graph: {
          activeTabId: 'tab_1',
          tabs: [],
          activePanelId: null,
          activeDialogId: null,
          hoverTarget: null,
          scrollPosition: null,
          lastUserEvent: null,
        },
      },
    ];
    const batch = buildBatch({
      tenantId: 'tenant_1',
      userId: 'user_1',
      sessionId: 'sess_1',
      events,
    });
    expect(batch.tenantId).toBe('tenant_1');
    expect(batch.userId).toBe('user_1');
    expect(batch.sessionId).toBe('sess_1');
    expect(batch.events).toBe(events);
  });
});
