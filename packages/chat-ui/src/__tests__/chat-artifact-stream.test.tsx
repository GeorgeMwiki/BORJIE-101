/**
 * Piece-G ChatArtifactStream tests.
 *
 * Verifies:
 *   * Renders zero artifacts → empty fragment
 *   * Renders a complete artifact via `<UiArtifact>`
 *   * Renders a streaming placeholder when `streaming: true`
 *   * Calls `persistArtifact` once per completed artifact
 *   * Ignores candidates missing required fields (id / componentType)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ChatArtifactStream,
  type ArtifactStreamCandidate,
} from '../generative-ui/ChatArtifactStream';

describe('<ChatArtifactStream />', () => {
  it('renders nothing when artifacts is empty', () => {
    const { container } = render(
      <ChatArtifactStream artifacts={[]} tenantId="tenant-1" />,
    );
    expect(container.querySelector('[data-testid="chat-artifact-stream"]')).toBeNull();
  });

  it('renders a complete artifact inline', () => {
    const artifacts: ReadonlyArray<ArtifactStreamCandidate> = [
      {
        id: 'art-1',
        componentType: 'kpi_tile',
        props: { label: 'MRR', format: 'currency', currency: 'TZS' },
        data: { value: 1234 },
        title: 'Monthly Recurring Revenue',
      },
    ];
    render(<ChatArtifactStream artifacts={artifacts} tenantId="tenant-1" />);
    expect(screen.getByTestId('chat-artifact-stream')).toBeInTheDocument();
    expect(screen.getByTestId('ui-artifact')).toBeInTheDocument();
    expect(screen.getByTestId('ui-artifact-title')).toHaveTextContent(
      'Monthly Recurring Revenue',
    );
  });

  it('renders a placeholder when streaming=true', () => {
    const artifacts: ReadonlyArray<ArtifactStreamCandidate> = [
      {
        id: 'art-stream',
        componentType: 'bar_chart',
        streaming: true,
      },
    ];
    render(<ChatArtifactStream artifacts={artifacts} tenantId="tenant-1" />);
    expect(screen.getByTestId('ui-artifact-placeholder')).toBeInTheDocument();
  });

  it('calls persistArtifact once per completed artifact', () => {
    const persist = vi.fn();
    const artifacts: ReadonlyArray<ArtifactStreamCandidate> = [
      {
        id: 'art-A',
        componentType: 'kpi_tile',
        props: { label: 'A', format: 'number' },
        data: { value: 1 },
      },
      {
        id: 'art-B',
        componentType: 'kpi_tile',
        props: { label: 'B', format: 'number' },
        data: { value: 2 },
      },
    ];
    const { rerender } = render(
      <ChatArtifactStream
        artifacts={artifacts}
        tenantId="tenant-1"
        persistArtifact={persist}
      />,
    );
    // Same array reference on re-render → no double-write.
    rerender(
      <ChatArtifactStream
        artifacts={artifacts}
        tenantId="tenant-1"
        persistArtifact={persist}
      />,
    );
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0]?.[0]?.id).toBe('art-A');
    expect(persist.mock.calls[1]?.[0]?.id).toBe('art-B');
  });

  it('does not persist a streaming artifact until it completes', () => {
    const persist = vi.fn();
    const { rerender } = render(
      <ChatArtifactStream
        artifacts={[
          { id: 'art-1', componentType: 'kpi_tile', streaming: true },
        ]}
        tenantId="tenant-1"
        persistArtifact={persist}
      />,
    );
    expect(persist).not.toHaveBeenCalled();

    rerender(
      <ChatArtifactStream
        artifacts={[
          {
            id: 'art-1',
            componentType: 'kpi_tile',
            props: { label: 'X', format: 'number' },
            data: { value: 1 },
          },
        ]}
        tenantId="tenant-1"
        persistArtifact={persist}
      />,
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('skips candidates missing required fields', () => {
    const artifacts: ReadonlyArray<ArtifactStreamCandidate> = [
      // Missing id.
      { componentType: 'kpi_tile' },
      // Missing componentType.
      { id: 'art-x' },
      // Valid.
      {
        id: 'art-y',
        componentType: 'kpi_tile',
        props: { label: 'Y', format: 'number' },
        data: { value: 1 },
      },
    ];
    render(<ChatArtifactStream artifacts={artifacts} tenantId="tenant-1" />);
    const stream = screen.getByTestId('chat-artifact-stream');
    const ids = Array.from(stream.querySelectorAll('[data-artifact-id]')).map(
      (n) => n.getAttribute('data-artifact-id'),
    );
    expect(ids).toEqual(['art-y']);
  });
});
