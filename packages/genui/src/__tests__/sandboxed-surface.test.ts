/**
 * SandboxedSurface — pure schema + helper tests (MCP-Apps escape-hatch lane).
 *
 * Proves the security invariants by construction:
 *   - srcdoc XOR src (discriminated union)
 *   - allow-same-origin is rejected (sandbox-escape guard)
 *   - csp is required + must declare default-src
 *   - postMessage origins are an explicit allowlist; "*" rejected
 *   - computeSandboxAttr always leads with allow-scripts
 */

import { describe, it, expect } from 'vitest';

import {
  SandboxedSurfaceSchema,
  SANDBOX_ALLOWED_TOKENS,
  computeSandboxAttr,
  isMessageOriginAllowed,
  safeParseSandboxedSurface,
  parseSandboxedSurface,
  type SandboxedSurface,
} from '../sandboxed-surface';

function srcdocSurface(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'sfc_1',
    version: 1,
    tenantId: 't1',
    surfaceKey: 'cadastre.viewer',
    title: 'Cadastre viewer',
    description: 'Interactive licence-block map',
    body: 'srcdoc',
    srcdoc: '<!doctype html><html><body><canvas id="map"></canvas></body></html>',
    sandboxTokens: ['allow-pointer-lock'],
    csp: "default-src 'none'; script-src 'unsafe-inline'; img-src https:",
    allowedMessageOrigins: ['https://sandbox.borjie.app'],
    heightPx: 480,
    createdBy: 'agent-1',
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
    ...overrides,
  };
}

function srcSurface(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'sfc_2',
    version: 1,
    tenantId: 't1',
    surfaceKey: 'regulator.embed',
    title: 'Regulator embed',
    description: 'Embedded vetted sandbox app',
    body: 'src',
    src: 'https://sandbox.borjie.app/apps/regulator',
    sandboxTokens: [],
    csp: "default-src 'self'",
    allowedMessageOrigins: [],
    heightPx: 600,
    createdBy: 'agent-1',
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
    ...overrides,
  };
}

describe('SandboxedSurfaceSchema', () => {
  it('accepts a well-formed srcdoc surface', () => {
    expect(() => parseSandboxedSurface(srcdocSurface())).not.toThrow();
  });

  it('accepts a well-formed src surface', () => {
    expect(safeParseSandboxedSurface(srcSurface())).not.toBeNull();
  });

  it('rejects a surface declaring BOTH srcdoc and src (discriminated union)', () => {
    const bad = srcdocSurface({ src: 'https://sandbox.borjie.app/x' });
    // body === 'srcdoc' ⇒ src is an unknown key (strict) ⇒ rejected.
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects allow-same-origin (sandbox-escape guard)', () => {
    const bad = srcdocSurface({ sandboxTokens: ['allow-same-origin'] });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects a csp without default-src', () => {
    const bad = srcdocSurface({ csp: "img-src https:" });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects an empty csp', () => {
    const bad = srcdocSurface({ csp: '' });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects "*" as a message origin', () => {
    const bad = srcdocSurface({ allowedMessageOrigins: ['*'] });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects a non-https message origin', () => {
    const bad = srcdocSurface({ allowedMessageOrigins: ['http://evil.test'] });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects a message origin with a path', () => {
    const bad = srcdocSurface({
      allowedMessageOrigins: ['https://sandbox.borjie.app/apps'],
    });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects a non-https src body', () => {
    const bad = srcSurface({ src: 'http://insecure.test/app' });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects a javascript: src body', () => {
    const bad = srcSurface({ src: 'javascript:alert(1)' });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects an unknown sandbox token', () => {
    const bad = srcdocSurface({ sandboxTokens: ['allow-top-navigation'] });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects an invalid surfaceKey', () => {
    const bad = srcdocSurface({ surfaceKey: 'Has Caps' });
    expect(safeParseSandboxedSurface(bad)).toBeNull();
  });

  it('rejects heightPx out of range', () => {
    expect(safeParseSandboxedSurface(srcdocSurface({ heightPx: 50 }))).toBeNull();
    expect(safeParseSandboxedSurface(srcdocSurface({ heightPx: 5000 }))).toBeNull();
  });
});

describe('computeSandboxAttr', () => {
  it('always leads with allow-scripts and appends sorted tokens', () => {
    const surface = parseSandboxedSurface(
      srcdocSurface({ sandboxTokens: ['allow-popups', 'allow-forms'] }),
    ) as SandboxedSurface;
    expect(computeSandboxAttr(surface)).toBe(
      'allow-scripts allow-forms allow-popups',
    );
  });

  it('returns just allow-scripts when no extra tokens', () => {
    expect(computeSandboxAttr({ sandboxTokens: [] })).toBe('allow-scripts');
  });

  it('dedupes repeated tokens', () => {
    expect(
      computeSandboxAttr({ sandboxTokens: ['allow-forms', 'allow-forms'] }),
    ).toBe('allow-scripts allow-forms');
  });

  it('never emits allow-same-origin from the allowlist', () => {
    expect(
      (SANDBOX_ALLOWED_TOKENS as ReadonlyArray<string>).includes('allow-same-origin'),
    ).toBe(false);
  });
});

describe('isMessageOriginAllowed', () => {
  const surface = { allowedMessageOrigins: ['https://sandbox.borjie.app'] };

  it('accepts an exact allowlisted origin', () => {
    expect(isMessageOriginAllowed(surface, 'https://sandbox.borjie.app')).toBe(true);
  });

  it('rejects a non-listed origin', () => {
    expect(isMessageOriginAllowed(surface, 'https://evil.test')).toBe(false);
  });

  it('rejects a prefix-matching impostor origin', () => {
    expect(
      isMessageOriginAllowed(surface, 'https://sandbox.borjie.app.evil.test'),
    ).toBe(false);
  });
});
