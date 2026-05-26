/**
 * InlineRichRender — shape extraction + render branches.
 *
 * Covers the founder-directive parity primitive shared between the
 * floating chat widget and the home full-screen chat. The component
 * MUST defensively shape-check every metadata field (everything comes
 * in as `unknown` over SSE), and MUST gracefully no-op when the
 * payload is malformed or absent.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  InlineRichRender,
  hasInlineRichContent,
} from '../shared/InlineRichRender';

describe('hasInlineRichContent', () => {
  it('returns false for missing / non-object metadata', () => {
    expect(hasInlineRichContent(undefined)).toBe(false);
    expect(hasInlineRichContent({})).toBe(false);
  });

  it('returns true when uiBlocks is well-formed', () => {
    expect(
      hasInlineRichContent({
        uiBlocks: [{ id: 'b1', type: 'concept_card' }],
      }),
    ).toBe(true);
  });

  it('returns true when uiParts is well-formed', () => {
    expect(
      hasInlineRichContent({
        uiParts: [{ kind: 'kpi-grid', tiles: [] }],
      }),
    ).toBe(true);
  });

  it('returns true when blackboard payload carries parts', () => {
    expect(
      hasInlineRichContent({
        blackboard: {
          conceptTitle: 'Rent Affordability',
          parts: [{ kind: 'kpi-grid', tiles: [] }],
        },
      }),
    ).toBe(true);
  });

  it('returns true when tabDetail payload carries parts', () => {
    expect(
      hasInlineRichContent({
        tabDetail: {
          title: 'Arrears dashboard',
          parts: [{ kind: 'kpi-grid', tiles: [] }],
        },
      }),
    ).toBe(true);
  });

  it('returns false when uiParts entries are missing kind', () => {
    expect(
      hasInlineRichContent({
        uiParts: [{ wrong: 'shape' }],
      }),
    ).toBe(false);
  });

  it('returns false when blackboard has neither title nor parts', () => {
    expect(
      hasInlineRichContent({
        blackboard: {},
      }),
    ).toBe(false);
  });
});

describe('InlineRichRender', () => {
  it('renders nothing when metadata is undefined', () => {
    const { container } = render(
      <InlineRichRender metadata={undefined} language="en" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when metadata carries no known fields', () => {
    const { container } = render(
      <InlineRichRender metadata={{ unrelated: true }} language="en" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the tab-detail card when metadata.tabDetail is present', () => {
    render(
      <InlineRichRender
        metadata={{
          tabDetail: {
            title: 'Arrears Dashboard',
            subtitle: 'Q2 forecast',
            parts: [
              {
                kind: 'kpi-grid',
                tiles: [
                  { label: 'Open arrears', value: 12, format: 'number' },
                ],
              },
            ],
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByTestId('inline-tab-detail')).toBeInTheDocument();
    expect(screen.getByTestId('inline-tab-detail-title').textContent).toBe(
      'Arrears Dashboard',
    );
    expect(screen.getByTestId('inline-tab-detail-subtitle').textContent).toBe(
      'Q2 forecast',
    );
  });

  it('renders the blackboard card when metadata.blackboard is present', () => {
    render(
      <InlineRichRender
        metadata={{
          blackboard: {
            conceptTitle: 'Rent Affordability Ratio',
            parts: [
              {
                kind: 'kpi-grid',
                tiles: [{ label: 'Ratio', value: '30%', format: 'percent' }],
              },
            ],
          },
        }}
        language="en"
      />,
    );
    expect(screen.getByTestId('inline-blackboard')).toBeInTheDocument();
    expect(screen.getByTestId('inline-blackboard-concept').textContent).toBe(
      'Rent Affordability Ratio',
    );
  });

  it('forwards uiBlocks to the chat-ui AdaptiveRenderer', () => {
    render(
      <InlineRichRender
        metadata={{
          uiBlocks: [
            {
              id: 'qr1',
              type: 'quick_replies',
              position: 'inline',
              replies: [{ label: 'Yes', prompt: 'yes' }],
            },
          ],
        }}
        language="en"
      />,
    );
    expect(screen.getByTestId('adaptive-renderer')).toBeInTheDocument();
    expect(screen.getByTestId('quick-replies')).toBeInTheDocument();
  });

  it('emits data-variant=compact for the floating widget surface', () => {
    render(
      <InlineRichRender
        metadata={{
          tabDetail: {
            title: 't',
            parts: [{ kind: 'kpi-grid', tiles: [{ label: 'L', value: 1, format: 'number' }] }],
          },
        }}
        language="en"
        variant="compact"
      />,
    );
    expect(screen.getByTestId('inline-rich-render').getAttribute('data-variant')).toBe(
      'compact',
    );
  });
});
