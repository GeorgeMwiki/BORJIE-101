/**
 * SegmentHeader — divider between chat segments when the topic shifts.
 */
import type { ChatSegment } from './types';
import type { Language } from '../chat-modes/types';

interface SegmentHeaderProps {
  readonly segment: ChatSegment;
  readonly language: Language;
}

export function SegmentHeader({ segment, language: _language }: SegmentHeaderProps): JSX.Element {
  return (
    <div
      data-testid="segment-header"
      data-segment-id={segment.id}
      role="separator"
      aria-label={segment.label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        margin: '12px 0',
        color: '#64748b',
        fontSize: 11,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} aria-hidden="true" />
      <span>{segment.label}</span>
      <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} aria-hidden="true" />
    </div>
  );
}
