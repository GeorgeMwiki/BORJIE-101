/**
 * SandboxedSurfaceFrame render test — proves the host renders the novel-surface
 * lane as a HARDENED iframe (sandbox + csp attrs), honours srcdoc XOR src, and
 * degrades gracefully on an invalid document.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SandboxedSurfaceFrame } from '../components/SandboxedSurfaceFrame';
import {
  parseSandboxedSurface,
  type SandboxedSurface,
} from '../sandboxed-surface';

function makeSrcdoc(): SandboxedSurface {
  return parseSandboxedSurface({
    id: 'sfc_1',
    version: 1,
    tenantId: 't1',
    surfaceKey: 'cadastre.viewer',
    title: 'Cadastre viewer',
    description: 'Interactive licence-block map',
    body: 'srcdoc',
    srcdoc: '<!doctype html><html><body>hi</body></html>',
    sandboxTokens: ['allow-forms'],
    csp: "default-src 'none'; script-src 'unsafe-inline'",
    allowedMessageOrigins: ['https://sandbox.borjie.app'],
    heightPx: 400,
    createdBy: 'agent-1',
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
  });
}

function makeSrc(): SandboxedSurface {
  return parseSandboxedSurface({
    id: 'sfc_2',
    version: 1,
    tenantId: 't1',
    surfaceKey: 'regulator.embed',
    title: 'Regulator embed',
    description: 'Embedded vetted app',
    body: 'src',
    src: 'https://sandbox.borjie.app/apps/regulator',
    sandboxTokens: [],
    csp: "default-src 'self'",
    allowedMessageOrigins: [],
    heightPx: 600,
    createdBy: 'agent-1',
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
  });
}

describe('SandboxedSurfaceFrame', () => {
  it('renders a srcdoc iframe with the hardened sandbox attr', () => {
    render(<SandboxedSurfaceFrame surface={makeSrcdoc()} />);
    const frame = screen.getByTestId('sandboxed-surface-frame') as HTMLIFrameElement;
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    // allow-same-origin must never appear.
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('srcdoc')).toContain('hi');
    expect(frame.getAttribute('csp')).toContain('default-src');
  });

  it('renders a src iframe pointing at the vetted sandbox origin', () => {
    render(<SandboxedSurfaceFrame surface={makeSrc()} />);
    const frame = screen.getByTestId('sandboxed-surface-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe(
      'https://sandbox.borjie.app/apps/regulator',
    );
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBeNull();
  });

  it('carries the surface key for routing/telemetry', () => {
    render(<SandboxedSurfaceFrame surface={makeSrcdoc()} />);
    const frame = screen.getByTestId('sandboxed-surface-frame');
    expect(frame.getAttribute('data-surface-key')).toBe('cadastre.viewer');
  });

  it('renders the fallback when the document is invalid', () => {
    // Bypass the type system with a malformed doc to hit the boundary guard.
    const malformed = { ...makeSrcdoc(), csp: '' } as unknown as SandboxedSurface;
    const { container } = render(
      <SandboxedSurfaceFrame
        surface={malformed}
        invalidFallback={<div data-testid="fallback">invalid</div>}
      />,
    );
    expect(screen.getByTestId('fallback')).toBeDefined();
    expect(container.querySelector('iframe')).toBeNull();
  });
});
