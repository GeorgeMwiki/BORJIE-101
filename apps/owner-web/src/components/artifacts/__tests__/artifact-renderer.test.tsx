/**
 * ArtifactRenderer — wave ARTIFACT-RICHNESS tests.
 *
 * Verifies the cockpit-side chrome around a server-rendered artifact:
 *  - bilingual sw/en classification badge + disclaimer
 *  - audit hash tail and ISO timestamp in the footer
 *  - skeleton state when isLoading
 *  - empty state copy + retry CTA when emptyState is set
 *  - dangerouslySetInnerHTML host elements only carry the supplied
 *    HTML when not in loading / empty mode (no double-render)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { ArtifactRenderer } from '../ArtifactRenderer';

const BASE = {
  title: 'Quarterly Brief',
  tenantTradingName: 'Acme Mining Co.',
  classification: 'internal' as const,
  auditHashTail: 'abcd1234',
  renderedAtUtc: '2026-05-29T10:00:00Z',
  authorDisplayName: 'Borjie brain',
};

describe('ArtifactRenderer chrome', () => {
  it('shows English classification + disclaimer when language=en', () => {
    render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml="<p>Body.</p>"
      />,
    );
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(
      screen.getByText('AI-generated. Decisions are yours.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/audit:abcd1234/)).toBeInTheDocument();
  });

  it('shows Swahili classification + disclaimer when language=sw', () => {
    render(
      <ArtifactRenderer
        {...BASE}
        language="sw"
        bodyHtml="<p>Body.</p>"
      />,
    );
    expect(screen.getByText('Ndani ya Kampuni')).toBeInTheDocument();
    expect(
      screen.getByText('Imeundwa na akili-bandia. Maamuzi ni yako.'),
    ).toBeInTheDocument();
  });

  it('renders body html host when not loading and not empty', () => {
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml="<p data-test='b'>Hello</p>"
      />,
    );
    expect(container.querySelector('.borjie-artifact-body-host')).toBeInTheDocument();
    expect(container.querySelector('[data-test="b"]')).toBeInTheDocument();
  });

  it('renders TOC and footnotes hosts when supplied', () => {
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml="<p>b</p>"
        tocHtml="<nav class='borjie-toc'><h2>Table of contents</h2><ol><li>A</li></ol></nav>"
        footnotesHtml="<section class='borjie-footnotes'><h2>Evidence</h2></section>"
      />,
    );
    expect(container.querySelector('.borjie-artifact-toc-host')).toBeInTheDocument();
    expect(container.querySelector('.borjie-artifact-footnotes-host')).toBeInTheDocument();
    expect(screen.getByText('Table of contents')).toBeInTheDocument();
    expect(screen.getByText('Evidence')).toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading=true', () => {
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml="<p>b</p>"
        isLoading
      />,
    );
    expect(container.querySelector('.borjie-artifact-skeleton')).toBeInTheDocument();
    expect(container.querySelector('.borjie-artifact-body-host')).not.toBeInTheDocument();
  });

  it('shows empty-state with retry CTA', () => {
    const onRetry = vi.fn();
    render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml=""
        emptyState={{ message: 'No data yet.', onRetry }}
      />,
    );
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
    const btn = screen.getByText('Retry');
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses Swahili retry label when language=sw and no custom label', () => {
    render(
      <ArtifactRenderer
        {...BASE}
        language="sw"
        bodyHtml=""
        emptyState={{ message: 'Hakuna.', onRetry: vi.fn() }}
      />,
    );
    expect(screen.getByText('Jaribu tena')).toBeInTheDocument();
  });

  it('reflects the confidential classification on the host element', () => {
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        classification="confidential"
        language="en"
        bodyHtml="<p>b</p>"
      />,
    );
    const root = container.querySelector('.borjie-artifact');
    expect(root?.getAttribute('data-classification')).toBe('confidential');
    expect(screen.getByText('Confidential')).toBeInTheDocument();
  });
});
