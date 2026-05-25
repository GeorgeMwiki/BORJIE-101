/**
 * VoiceOverlay — full-screen voice-conversation mode.
 *
 * Covers the viewport with a centered waveform + persona name while the
 * user is holding the mic. Close button drops back to the expanded panel.
 */
import type { WidgetStrings } from './types';
import { WaveformVisualizer } from './WaveformVisualizer';

interface VoiceOverlayProps {
  readonly levels: readonly number[];
  readonly isListening: boolean;
  readonly strings: WidgetStrings;
  readonly onClose: () => void;
}

export function VoiceOverlay({ levels, isListening, strings, onClose }: VoiceOverlayProps): JSX.Element {
  return (
    <div
      data-testid="voice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={strings.personaName}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.92)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        zIndex: 10_002,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{strings.personaName}</h2>
      <WaveformVisualizer levels={levels} active={isListening} ariaLabel={strings.mic} />
      <button
        type="button"
        onClick={onClose}
        aria-label={strings.collapse}
        style={{
          background: '#f8fafc',
          color: '#0f172a',
          border: 'none',
          padding: '8px 20px',
          borderRadius: 999,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {strings.collapse}
      </button>
    </div>
  );
}
