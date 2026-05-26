// @vitest-environment jsdom
/**
 * hooks-integration test — exercises the React hook bodies through
 * @testing-library/react. This is the only test file in the package
 * that pulls in a DOM environment; everything else runs against pure
 * helpers extracted from the hooks.
 *
 * Targets:
 *   - SessionMirrorProvider binds scope; useSessionScope reads it.
 *   - SessionMirrorProvider with disabled=true returns null scope.
 *   - useFieldCapture wires onChange + onBlur to the capture pipeline.
 *   - useUiStateBeacon publishes once per shape-change.
 */

import { act, render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  SessionMirrorProvider,
  useSessionScope,
  useCaptureEmit,
} from '../provider/session-mirror-provider.js';
import { useFieldCapture } from '../field-capture/use-field-capture.js';
import { useUiStateBeacon } from '../ui-beacon/use-ui-state-beacon.js';
import type { CaptureEvent } from '../types.js';

function makeFetchStub(): { calls: string[]; fetchImpl: typeof fetch } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (init?.body) {
      // Mark that we saw a body — useful when assertions need it.
      calls.push(typeof init.body === 'string' ? init.body : '<blob>');
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('SessionMirrorProvider integration', () => {
  it('binds the scope so consumers read it via useSessionScope', () => {
    let captured: ReturnType<typeof useSessionScope> = null;
    function Reader(): React.ReactElement {
      captured = useSessionScope();
      return <div />;
    }
    const { fetchImpl } = makeFetchStub();
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 'tenant_1', userId: 'user_1', sessionId: 'sess_1' }}
        fetchImpl={fetchImpl}
      >
        <Reader />
      </SessionMirrorProvider>,
    );
    expect(captured).not.toBeNull();
    expect(captured?.tenantId).toBe('tenant_1');
    expect(captured?.userId).toBe('user_1');
    expect(captured?.sessionId).toBe('sess_1');
  });

  it('returns null scope when disabled=true', () => {
    let captured: ReturnType<typeof useSessionScope> = { tenantId: '', userId: '', sessionId: '' };
    function Reader(): React.ReactElement {
      captured = useSessionScope();
      return <div />;
    }
    const { fetchImpl } = makeFetchStub();
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 'tenant_1', userId: 'user_1', sessionId: 'sess_1' }}
        disabled
        fetchImpl={fetchImpl}
      >
        <Reader />
      </SessionMirrorProvider>,
    );
    expect(captured).toBeNull();
  });

  it('returns a no-op emit when disabled=true', () => {
    let emit: ((e: CaptureEvent) => void) | null = null;
    function Reader(): React.ReactElement {
      emit = useCaptureEmit();
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 'tenant_1', userId: 'user_1', sessionId: 'sess_1' }}
        disabled
      >
        <Reader />
      </SessionMirrorProvider>,
    );
    expect(typeof emit).toBe('function');
    // No throw, no error — it really is a no-op.
    emit?.({
      kind: 'ui_state',
      emittedAt: '2026-01-01T00:00:00.000Z',
      sessionId: 'sess_1',
      graph: {
        activeTabId: null,
        tabs: [],
        activePanelId: null,
        activeDialogId: null,
        hoverTarget: null,
        scrollPosition: null,
        lastUserEvent: null,
      },
    });
  });

  it('default scope outside the provider is null', () => {
    let captured: ReturnType<typeof useSessionScope> = { tenantId: '', userId: '', sessionId: '' };
    function Reader(): React.ReactElement {
      captured = useSessionScope();
      return <div />;
    }
    render(<Reader />);
    expect(captured).toBeNull();
  });
});

describe('useFieldCapture', () => {
  it('returns onChange + onBlur callbacks', () => {
    let returned: ReturnType<typeof useFieldCapture> | null = null;
    function Inner(): React.ReactElement {
      returned = useFieldCapture({
        tabId: 'tab_1',
        fieldId: 'company_name',
      });
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 't', userId: 'u', sessionId: 's' }}
      >
        <Inner />
      </SessionMirrorProvider>,
    );
    expect(typeof returned?.onChange).toBe('function');
    expect(typeof returned?.onBlur).toBe('function');
  });

  it('does nothing when disabled=true (no callback throws)', () => {
    let returned: ReturnType<typeof useFieldCapture> | null = null;
    function Inner(): React.ReactElement {
      returned = useFieldCapture({
        tabId: 'tab_1',
        fieldId: 'company_name',
        disabled: true,
      });
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 't', userId: 'u', sessionId: 's' }}
      >
        <Inner />
      </SessionMirrorProvider>,
    );
    // No-op contract: calling onChange/onBlur in disabled mode must not throw.
    returned?.onChange('jam');
    returned?.onBlur();
  });

  it('schedules a flush after the debounce window and POSTs', async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = makeFetchStub();
    function Inner(): React.ReactElement {
      const { onChange } = useFieldCapture({
        tabId: 'tab_1',
        fieldId: 'company_name',
      });
      // Simulate a keystroke immediately.
      React.useEffect(() => {
        onChange('Jamhuri');
      }, [onChange]);
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 't', userId: 'u', sessionId: 's' }}
        fetchImpl={fetchImpl}
      >
        <Inner />
      </SessionMirrorProvider>,
    );
    await act(async () => {
      // 500ms debounce + 500ms batch flush.
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toBe('/api/v1/session-mirror/capture');
    vi.useRealTimers();
  });
});

describe('useUiStateBeacon', () => {
  it('publishes when mounted with a non-empty graph', async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = makeFetchStub();
    function Inner(): React.ReactElement {
      useUiStateBeacon({
        tabs: [
          {
            id: 'tab_1',
            recipeId: 'BuyerKYBStart',
            recipeVersion: 4,
            openedAt: '2026-01-01T00:00:00.000Z',
            isDirty: false,
            isActive: true,
          },
        ],
        activeTabId: 'tab_1',
        activePanelId: null,
        activeDialogId: null,
        hoverTarget: null,
        scrollPosition: null,
        lastUserEvent: null,
      });
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 't', userId: 'u', sessionId: 's' }}
        fetchImpl={fetchImpl}
      >
        <Inner />
      </SessionMirrorProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(calls.length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('honors disabled=true and does not publish', async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = makeFetchStub();
    function Inner(): React.ReactElement {
      useUiStateBeacon({
        tabs: [],
        activeTabId: null,
        activePanelId: null,
        activeDialogId: null,
        hoverTarget: null,
        scrollPosition: null,
        lastUserEvent: null,
        disabled: true,
      });
      return <div />;
    }
    render(
      <SessionMirrorProvider
        scope={{ tenantId: 't', userId: 'u', sessionId: 's' }}
        fetchImpl={fetchImpl}
      >
        <Inner />
      </SessionMirrorProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(calls.length).toBe(0);
    vi.useRealTimers();
  });
});
