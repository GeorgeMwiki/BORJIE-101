'use client';

/**
 * SandboxedSurfaceFrame — renders a `SandboxedSurface` (the MCP-Apps
 * escape-hatch lane) as a hardened, CSP-isolated iframe.
 *
 * This is the genuinely-novel-surface counterpart to `AdaptiveRenderer`
 * (vetted primitives) and `GenUITabHost` (PortalTab field/widget vocab).
 * When the MD needs a surface the catalogs can't express, it mints a
 * `SandboxedSurface` document and the host renders it HERE — inside an
 * iframe that:
 *   - re-validates the document at the boundary (`safeParseSandboxedSurface`)
 *     before rendering anything (never trust the document at render time);
 *   - carries a restrictive `sandbox` attr computed from the allowlist
 *     (`computeSandboxAttr` — always `allow-scripts` + opt-in tokens, never
 *     `allow-same-origin`);
 *   - applies the document's CSP via the `csp` attribute on the frame;
 *   - only honours postMessage from `allowedMessageOrigins` (exact match).
 *
 * Anti-patterns enforced (CLAUDE.md):
 *   - no raw HTML interpolation — `srcdoc` goes into the iframe's own
 *     `srcDoc` prop (opaque origin), NOT `dangerouslySetInnerHTML`;
 *   - never `'*'` postMessage targets/origins;
 *   - invalid documents render a graceful card, never crash the host.
 */

import { useEffect, useRef, type ReactElement } from 'react';

import {
  computeSandboxAttr,
  isMessageOriginAllowed,
  safeParseSandboxedSurface,
  type SandboxedSurface,
} from '../sandboxed-surface';

export interface SandboxedSurfaceFrameProps {
  /** The surface document. Re-validated before render. */
  readonly surface: SandboxedSurface;
  /**
   * Optional handler for messages the embedded frame posts to the host.
   * Only invoked for events whose origin is in `allowedMessageOrigins`.
   */
  readonly onMessage?: (data: unknown, origin: string) => void;
  /** Optional extra class on the wrapper. */
  readonly className?: string;
  /** Fallback rendered when the document fails re-validation. */
  readonly invalidFallback?: ReactElement | null;
}

export function SandboxedSurfaceFrame({
  surface,
  onMessage,
  className,
  invalidFallback = null,
}: SandboxedSurfaceFrameProps): ReactElement | null {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // Boundary re-validation — never trust the document at render time.
  const valid = safeParseSandboxedSurface(surface);

  useEffect(() => {
    if (!valid || !onMessage) return;
    const frame = frameRef.current;
    function handle(event: MessageEvent): void {
      // Only accept from the frame element AND an allowlisted origin.
      if (frame && event.source !== frame.contentWindow) return;
      if (!isMessageOriginAllowed(valid!, event.origin)) return;
      onMessage!(event.data, event.origin);
    }
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [valid, onMessage]);

  if (!valid) {
    return invalidFallback;
  }

  const sandbox = computeSandboxAttr(valid);
  const commonProps = {
    ref: frameRef,
    title: valid.title,
    sandbox,
    // `csp` constrains the embedded document's own fetches/scripts.
    csp: valid.csp,
    referrerPolicy: 'no-referrer' as const,
    loading: 'lazy' as const,
    style: { width: '100%', height: `${valid.heightPx}px`, border: '0' },
    'data-testid': 'sandboxed-surface-frame',
    'data-surface-key': valid.surfaceKey,
  };

  return (
    <div
      className={['borjie-sandboxed-surface', className].filter(Boolean).join(' ')}
      data-testid="sandboxed-surface-host"
    >
      {valid.body === 'srcdoc' ? (
        <iframe {...commonProps} srcDoc={valid.srcdoc} />
      ) : (
        <iframe {...commonProps} src={valid.src} />
      )}
    </div>
  );
}
