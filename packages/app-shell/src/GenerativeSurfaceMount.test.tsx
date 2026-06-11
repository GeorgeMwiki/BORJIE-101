/**
 * GenerativeSurfaceMount — the suite-wide MD-authored-surface seam.
 *
 * Proves the lane end-to-end at the integration boundary:
 *   - portal-tab lane: an incremental A2UI patch (add-field) is applied to a
 *     live tab and the PATCHED tab reaches the consumer's renderTab callback
 *     (the "edit a live surface without a full re-render" path);
 *   - sandboxed lane: a SandboxedSurface renders as a hardened iframe.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { GenerativeSurfaceMount } from './GenerativeSurfaceMount.js';
import {
  buildFallbackTab,
  type PortalTab,
  type PortalTabPatch,
} from '@borjie/portal-genui';
import {
  parseSandboxedSurface,
  type SandboxedSurface,
} from '@borjie/genui';

function freshTab(): PortalTab {
  return buildFallbackTab({
    intent: {
      proposedTabKey: 'hr.payroll',
      proposedTabTitle: 'Payroll',
      domain: 'hr',
      confidence: 0.8,
      evidence: [],
      sourceMessage: 's',
      usedLlm: false,
    },
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
    nowIso: '2026-05-24T12:00:00.000Z',
    id: 'tab_a',
    sourceConversationId: undefined,
  });
}

function sandboxedSurface(): SandboxedSurface {
  return parseSandboxedSurface({
    id: 'sfc_1',
    version: 1,
    tenantId: 't1',
    surfaceKey: 'cadastre.viewer',
    title: 'Cadastre viewer',
    description: 'Novel surface',
    body: 'srcdoc',
    srcdoc: '<!doctype html><html><body>map</body></html>',
    sandboxTokens: ['allow-forms'],
    csp: "default-src 'none'; script-src 'unsafe-inline'",
    allowedMessageOrigins: ['https://sandbox.borjie.app'],
    heightPx: 400,
    createdBy: 'agent-1',
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
  });
}

describe('GenerativeSurfaceMount — portal-tab lane', () => {
  it('renders the tab as-is when no patch is supplied', () => {
    const tab = freshTab();
    render(
      <GenerativeSurfaceMount
        surface={{ kind: 'portal-tab', tab }}
        renderTab={(t) => <div data-testid="tab-title">{t.title}</div>}
      />,
    );
    expect(screen.getByTestId('tab-title').textContent).toBe('Payroll');
  });

  it('applies an incremental patch and renders the PATCHED tab', () => {
    const tab = freshTab();
    const sectionKey = tab.sections[0]!.key;
    const patch: PortalTabPatch = {
      version: 1,
      tabId: 'tab_a',
      ops: [
        {
          op: 'add-field',
          sectionKey,
          field: { key: 'bonus', label: 'Bonus', kind: 'currency' },
        },
        { op: 'update-tab-meta', title: 'Payroll (live)' },
      ],
    };

    render(
      <GenerativeSurfaceMount
        surface={{
          kind: 'portal-tab',
          tab,
          patch,
          patchOptions: { actorId: 'agent-1', nowIso: '2026-06-08T10:00:00.000Z' },
        }}
        renderTab={(t) => (
          <div>
            <span data-testid="patched-title">{t.title}</span>
            <span data-testid="field-count">
              {String(t.sections[0]!.fields.length)}
            </span>
            <span data-testid="has-bonus">
              {String(t.sections[0]!.fields.some((f) => f.key === 'bonus'))}
            </span>
          </div>
        )}
      />,
    );

    expect(screen.getByTestId('patched-title').textContent).toBe('Payroll (live)');
    expect(screen.getByTestId('has-bonus').textContent).toBe('true');
    // Original tab object was NOT mutated.
    expect(tab.title).toBe('Payroll');
    expect(tab.sections[0]!.fields.some((f) => f.key === 'bonus')).toBe(false);
  });

  it('reports a patch error and falls back to the unpatched tab', () => {
    const tab = freshTab();
    let reported: { reason: string; message: string } | null = null;
    const patch: PortalTabPatch = {
      version: 1,
      tabId: 'tab_a',
      ops: [{ op: 'remove-section', sectionKey: 'ghost' }],
    };

    render(
      <GenerativeSurfaceMount
        surface={{
          kind: 'portal-tab',
          tab,
          patch,
          patchOptions: { actorId: 'agent-1' },
        }}
        renderTab={(t) => <div data-testid="title">{t.title}</div>}
        onPatchError={(reason, message) => {
          reported = { reason, message };
        }}
      />,
    );

    expect(screen.getByTestId('title').textContent).toBe('Payroll');
    expect(reported).not.toBeNull();
    expect(reported!.reason).toBe('section-not-found');
  });
});

describe('GenerativeSurfaceMount — sandboxed lane', () => {
  it('renders a SandboxedSurface as a hardened iframe', () => {
    render(
      <GenerativeSurfaceMount surface={{ kind: 'sandboxed', surface: sandboxedSurface() }} />,
    );
    const frame = screen.getByTestId('sandboxed-surface-frame') as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('marks the wrapper with the surface kind', () => {
    const { container } = render(
      <GenerativeSurfaceMount surface={{ kind: 'sandboxed', surface: sandboxedSurface() }} />,
    );
    expect(
      container.querySelector('[data-surface-kind="sandboxed"]'),
    ).not.toBeNull();
  });
});
