/**
 * ReportPlayer — behaviour smoke tests.
 *
 * Covers:
 *  1. Renders with chapter markers (each marker becomes a button).
 *  2. Speed control updates the underlying audio element's
 *     playbackRate.
 *  3. Clicking a chapter button seeks the audio element to that
 *     marker's `at` timestamp.
 *
 * `plyr` is aliased to a no-op stub in vitest.config.ts (jsdom lacks
 * the MediaElement APIs Plyr needs at construction time). The
 * component asserts directly against the raw <audio> element under
 * test, which is exactly the surface Plyr would manipulate live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReportPlayer } from '../src/components/reports/ReportPlayer';
import type { ReportAudioPayload } from '../src/components/reports/report-player-schema';

// `plyr` and `plyr-borjie.css` are aliased to stubs in vitest.config.ts
// so vitest can statically resolve the dynamic `import('plyr')` and the
// CSS side-effect import without an actual install / CSS parser.

// Stub the transcript fetch so SyncedTranscript does not hit the network.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        'WEBVTT\n\n00:00.000 --> 00:05.000\nIntro chapter narration.\n',
        { status: 200 },
      ),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FIXTURE: ReportAudioPayload = {
  id: 'daily-2025-01-15',
  title: 'Daily Owner Brief — Jan 15',
  audio_url: 'https://reports-cdn.example.com/audio/daily-2025-01-15.mp3',
  transcript_url: 'https://reports-cdn.example.com/audio/daily-2025-01-15.vtt',
  chapter_markers: [
    { at: 0, label: 'Intro' },
    { at: 32, label: 'Production' },
    { at: 88, label: 'Cash & treasury' },
    { at: 145, label: 'Risks & decisions' },
  ],
};

describe('ReportPlayer (O-W-18)', () => {
  it('renders one button per chapter marker', () => {
    render(<ReportPlayer report={FIXTURE} lang="en" />);
    for (let i = 0; i < FIXTURE.chapter_markers.length; i += 1) {
      const button = screen.getByTestId(`chapter-button-${i}`);
      expect(button).toBeTruthy();
      expect(button.textContent).toContain(FIXTURE.chapter_markers[i]!.label);
    }
  });

  it('speed control updates the audio element playback rate', () => {
    render(<ReportPlayer report={FIXTURE} lang="en" />);
    const audio = screen.getByTestId('report-player-audio') as HTMLAudioElement;
    const selector = screen.getByTestId('speed-selector') as HTMLSelectElement;
    expect(audio.playbackRate).toBe(1);
    fireEvent.change(selector, { target: { value: '1.5' } });
    expect(audio.playbackRate).toBe(1.5);
    fireEvent.change(selector, { target: { value: '0.8' } });
    expect(audio.playbackRate).toBe(0.8);
  });

  it('clicking a chapter button seeks the audio to that timestamp', () => {
    render(<ReportPlayer report={FIXTURE} lang="en" />);
    const audio = screen.getByTestId('report-player-audio') as HTMLAudioElement;
    // jsdom's HTMLMediaElement is a no-op stub — currentTime is
    // writable via the property setter but reads back the assigned
    // value, which is exactly what we need to assert the seek.
    Object.defineProperty(audio, 'currentTime', {
      writable: true,
      value: 0,
    });
    const chapter2 = screen.getByTestId('chapter-button-2');
    fireEvent.click(chapter2);
    expect(audio.currentTime).toBe(FIXTURE.chapter_markers[2]!.at);
  });
});
