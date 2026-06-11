/**
 * The GENERATIVITY GUARANTEE (render half).
 *
 * The defining property of the unified engine: an `ArtifactSpec` carrying
 * an UNKNOWN / never-seen kind ROUTES (to inline-text) AND RENDERS
 * (`UnknownKindCard`) — it NEVER throws and NEVER needs a new hardcoded
 * branch. A brand-new organ the brain invents degrades gracefully the
 * instant it ships; H11 telemetry then tells the team which primitive to
 * grow next.
 *
 * Also asserts a KNOWN kind renders through the wrapped AdaptiveRenderer,
 * and the ONE ActionButton dispatches an intent through the host membrane.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UnifiedArtifactRenderer } from '../UnifiedArtifactRenderer.js';
import { routeArtifact } from '../route-artifact.js';
import type {
  HostContext,
  ArtifactActionResult,
} from '../host-context.js';
import { makeSpec, signals } from './fixtures.js';

/** A minimal host context with stubbed ports. */
function makeHost(
  overrides: Partial<HostContext> = {},
): HostContext {
  return {
    surface: 'inline-chip',
    locale: 'en',
    density: 'comfortable',
    theme: 'light',
    onAction: vi.fn(
      async (): Promise<ArtifactActionResult> => ({ status: 'executed' }),
    ),
    formatCurrency: (amount: number, code: string) => `${code} ${amount}`,
    ...overrides,
  };
}

describe('generativity guarantee — unknown kind renders UnknownKindCard, never throws', () => {
  it('renders UnknownKindCard for a never-seen kind without throwing', () => {
    const spec = makeSpec({
      kind: 'geological-drill-core-viewer',
      config: { coreId: 'DDH-001' },
    });
    const host = makeHost();

    // Routing half: it routes (does not throw).
    const decision = routeArtifact(spec);
    expect(decision.surface).toBe('inline-text');

    // Render half: it renders the graceful-degrade card.
    expect(() =>
      render(<UnifiedArtifactRenderer spec={spec} host={host} />),
    ).not.toThrow();

    // UnknownKindCard renders a data-attr tagged with the unknown kind.
    const card = document.querySelector(
      '[data-genui-unknown-kind="geological-drill-core-viewer"]',
    );
    expect(card).not.toBeNull();
  });

  it('the container is tagged with the unknown kind + surface for telemetry', () => {
    const spec = makeSpec({ kind: 'totally-novel-organ', config: null });
    render(
      <UnifiedArtifactRenderer
        spec={spec}
        host={makeHost({ surface: 'inline-text' })}
      />,
    );
    const container = document.querySelector(
      '[data-artifact-kind="totally-novel-organ"]',
    );
    expect(container).not.toBeNull();
    expect(container?.getAttribute('data-artifact-surface')).toBe('inline-text');
  });

  it('renders a KNOWN kind through the wrapped AdaptiveRenderer (no UnknownKindCard)', () => {
    const spec = makeSpec({
      kind: 'kpi-grid',
      config: {
        tiles: [{ label: 'Output', value: 42, format: 'number' }],
      },
    });
    render(<UnifiedArtifactRenderer spec={spec} host={makeHost()} />);
    // Known kind → NOT degraded to the unknown-kind card.
    expect(
      document.querySelector('[data-genui-unknown-kind]'),
    ).toBeNull();
    // The container is tagged as a known kpi-grid artifact and the
    // wrapped AdaptiveRenderer mounted its primitive content.
    const container = document.querySelector('[data-artifact-kind="kpi-grid"]');
    expect(container).not.toBeNull();
    expect(container?.textContent).toContain('Output');
  });
});

describe('the ONE action membrane — ActionButton routes intents through the host', () => {
  it('dispatches a spec action through host.onAction and reaches done', async () => {
    const onAction = vi.fn(
      async (): Promise<ArtifactActionResult> => ({ status: 'executed' }),
    );
    const spec = makeSpec({
      kind: 'kpi-grid',
      config: {
        tiles: [{ label: 'Output', value: 1, format: 'number' }],
      },
      actions: [
        { id: 'a1', label: 'Create reminder', verb: 'create_reminder' },
      ],
    });
    render(
      <UnifiedArtifactRenderer spec={spec} host={makeHost({ onAction })} />,
    );
    const btn = screen.getByText('Create reminder');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledTimes(1);
    });
    expect(onAction.mock.calls[0]?.[0]?.verb).toBe('create_reminder');
    await waitFor(() => {
      expect(btn.getAttribute('data-artifact-action-state')).toBe('done');
    });
  });

  it('an unknown verb deferToBrain drives the button to handling', async () => {
    const onAction = vi.fn(
      async (): Promise<ArtifactActionResult> => ({ status: 'deferToBrain' }),
    );
    const spec = makeSpec({
      kind: 'kpi-grid',
      config: {
        tiles: [{ label: 'X', value: 1, format: 'number' }],
      },
      actions: [
        { id: 'a1', label: 'Do novel thing', verb: 'never_seen_verb' },
      ],
    });
    render(
      <UnifiedArtifactRenderer spec={spec} host={makeHost({ onAction })} />,
    );
    const btn = screen.getByText('Do novel thing');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(btn.getAttribute('data-artifact-action-state')).toBe('handling');
    });
  });
});
