/**
 * Parity — home vs floating chat surfaces.
 *
 * Founder directive: the floating chat widget MUST render the same
 * inline rich content (tab-detail, blackboard, uiParts, uiBlocks) as
 * the full-screen home chat tab. We assert parity by feeding identical
 * metadata into the SHARED `InlineRichRender` from both the expanded
 * (home) and compact (floating) surfaces, then comparing the rendered
 * markup modulo the surface-specific variant marker.
 *
 * The compact-variant assertion at the bottom of the file pins the
 * floating-specific layout marker (`data-variant=compact`) so a future
 * regression that swaps the variant wiring is caught immediately.
 *
 * The MessageBubble case at the end exercises the wire-up at the
 * bubble level — that's the actual integration point inside both the
 * widget's ChatPanel and the home chat's bubble list.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { InlineRichRender } from '../shared/InlineRichRender';
import { MessageBubble } from '../widget/MessageBubble';
import type { ChatMessage } from '../widget/types';

const BLACKBOARD_METADATA: Record<string, unknown> = {
  blackboard: {
    conceptTitle: 'Rent Affordability Ratio',
    parts: [
      {
        kind: 'kpi-grid',
        title: 'Snapshot',
        tiles: [
          { label: 'Ratio', value: 30, format: 'percent' },
          { label: 'Median rent', value: 25000, format: 'number' },
        ],
      },
    ],
  },
};

const TAB_DETAIL_METADATA: Record<string, unknown> = {
  tabDetail: {
    title: 'Arrears Dashboard',
    subtitle: 'Q2 forecast',
    parts: [
      {
        kind: 'kpi-grid',
        title: 'KPIs',
        tiles: [{ label: 'Cases', value: 14, format: 'number' }],
      },
    ],
  },
};

/**
 * Strip the variant-specific layout signals so the textual / DOM
 * structure can be compared across surfaces. Removes:
 *   - the data-variant attribute on the wrapper (compact vs expanded)
 *   - inline `style` attributes (padding / font-size differ by variant)
 *
 * Keeps everything else — test IDs, headings, embedded KPI labels and
 * values — so any DROP in rendered content (the actual parity gap) is
 * caught.
 */
function normalizeForParity(html: string): string {
  return html
    .replace(/data-variant="(expanded|compact)"/g, 'data-variant="X"')
    .replace(/ style="[^"]*"/g, '');
}

describe('home vs floating parity — blackboard payload', () => {
  it('produces equivalent rich content across surfaces', () => {
    const homeView = render(
      <InlineRichRender
        metadata={BLACKBOARD_METADATA}
        language="en"
        variant="expanded"
      />,
    );
    const homeHtml = normalizeForParity(homeView.container.innerHTML);
    homeView.unmount();

    const floatingView = render(
      <InlineRichRender
        metadata={BLACKBOARD_METADATA}
        language="en"
        variant="compact"
      />,
    );
    const floatingHtml = normalizeForParity(floatingView.container.innerHTML);
    floatingView.unmount();

    // Both surfaces render the same data-testid landmarks + textual
    // content. The variant marker is normalised out so a width
    // difference doesn't count as a parity break.
    expect(homeHtml).toBe(floatingHtml);
  });
});

describe('home vs floating parity — tab-detail payload', () => {
  it('produces equivalent rich content across surfaces', () => {
    const homeView = render(
      <InlineRichRender
        metadata={TAB_DETAIL_METADATA}
        language="en"
        variant="expanded"
      />,
    );
    const homeHtml = normalizeForParity(homeView.container.innerHTML);
    homeView.unmount();

    const floatingView = render(
      <InlineRichRender
        metadata={TAB_DETAIL_METADATA}
        language="en"
        variant="compact"
      />,
    );
    const floatingHtml = normalizeForParity(floatingView.container.innerHTML);
    floatingView.unmount();

    expect(homeHtml).toBe(floatingHtml);
  });
});

describe('MessageBubble compact tab-detail snapshot', () => {
  it('renders the rich embed inside a compact-variant bubble', () => {
    const message: ChatMessage = {
      id: 'm-tab-1',
      role: 'mwikila',
      text: 'Here is the arrears dashboard you asked about.',
      language: 'en',
      createdAt: '2026-05-27T10:00:00Z',
      metadata: TAB_DETAIL_METADATA,
    };
    const { container } = render(
      <MessageBubble
        message={message}
        personaName="Mr. Mwikila"
        inlineVariant="compact"
        inlineLanguage="en"
      />,
    );

    // The bubble must include the inline rich-render landmark...
    const inline = container.querySelector(
      '[data-testid="inline-rich-render"]',
    );
    expect(inline).not.toBeNull();
    expect(inline?.getAttribute('data-variant')).toBe('compact');

    // ...AND the tab-detail card with its title intact.
    const tabDetail = container.querySelector(
      '[data-testid="inline-tab-detail"]',
    );
    expect(tabDetail).not.toBeNull();

    const title = container.querySelector(
      '[data-testid="inline-tab-detail-title"]',
    );
    expect(title?.textContent).toBe('Arrears Dashboard');

    // Persona name is never replaced with a junior name (canonical
    // display directive). Body text + persona render normally.
    expect(container.textContent).toContain('Mr. Mwikila');
    expect(container.textContent).toContain(
      'Here is the arrears dashboard you asked about.',
    );

    // Pin the inline subtree shape — every landmark MUST be present
    // and tagged with the compact variant. This is the explicit
    // structural assertion (a snapshot would catch the same thing but
    // is more fragile across vitest snapshot-engine upgrades).
    const inlineHtml = inline?.outerHTML ?? '';
    expect(inlineHtml).toContain('data-testid="inline-rich-render"');
    expect(inlineHtml).toContain('data-variant="compact"');
    expect(inlineHtml).toContain('data-testid="inline-tab-detail"');
    expect(inlineHtml).toContain(
      'data-testid="inline-tab-detail-title"',
    );
    // The embedded KPI tile labels also flow through so consumers can
    // assert their primitives reached the renderer.
    expect(inlineHtml).toContain('Cases');
  });
});
