'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { ChapterList } from './ChapterList';
import { SyncedTranscript } from './SyncedTranscript';
import { ReportAudioPayloadSchema, type ReportAudioPayload } from './report-player-schema';
import { REPORT_PLAYER_STRINGS, type Lang } from './strings';
import './plyr-borjie.css';

/**
 * Local structural type for the Plyr instance — we keep it minimal
 * (just `destroy`) so we do not need to import `plyr/dist/plyr.d.ts`
 * at type-check time. The runtime ctor is lazy-loaded inside the
 * effect below.
 */
interface PlyrInstance {
  readonly destroy?: () => void;
}

const PLAYBACK_SPEEDS: ReadonlyArray<number> = [0.8, 1, 1.25, 1.5];

interface ReportPlayerProps {
  readonly report: ReportAudioPayload;
  readonly lang?: Lang;
  readonly shareUrl?: string;
}

/**
 * Plyr-skinned audio player for owner-web Reports & exports (O-W-18).
 *
 * Behaviour:
 *  - Lazy-loads Plyr from `plyr` only on the client so the SSR pass
 *    skips the audio element entirely. Plyr is ~30KB gzipped and
 *    depends on `document` at import time.
 *  - Exposes play/pause, progress bar, speed selector, download, and a
 *    share-to-WhatsApp button. Speed defaults to 1x and falls back if
 *    the underlying audio element does not support `playbackRate`.
 *  - Chapter markers render as keyboard-navigable buttons in a sidebar.
 *  - Synced transcript highlights the active word using `timeupdate`.
 *
 * Immutability: chapters / speeds are readonly props; player state
 * lives in refs / hooks. No mutation of the `report` payload.
 */
export function ReportPlayer({ report, lang = 'sw', shareUrl }: ReportPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const plyrRef = useRef<PlyrInstance | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const t = REPORT_PLAYER_STRINGS[lang];

  // Defensive: re-validate the prop at the boundary in case a caller
  // passes a loose object. Throws at render so dev surfaces the issue.
  const validated = useMemo(() => ReportAudioPayloadSchema.parse(report), [report]);

  // Lazy-import Plyr only on the client; mount once per audio element.
  useEffect(() => {
    if (!audioRef.current) return;
    let cancelled = false;
    let instance: PlyrInstance | null = null;
    void import('plyr')
      .then((mod) => {
        if (cancelled || !audioRef.current) return;
        const PlyrCtor = (mod as { default: new (el: HTMLElement, opts: unknown) => PlyrInstance }).default;
        instance = new PlyrCtor(audioRef.current, {
          controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings'],
          settings: ['speed'],
          speed: { selected: 1, options: [...PLAYBACK_SPEEDS] },
          keyboard: { focused: true, global: false },
        });
        plyrRef.current = instance;
      })
      .catch(() => {
        // Plyr failed to load — fall back to the native <audio> controls.
        if (audioRef.current) audioRef.current.controls = true;
      });
    return () => {
      cancelled = true;
      if (instance && typeof instance.destroy === 'function') instance.destroy();
      plyrRef.current = null;
    };
  }, [validated.audio_url]);

  // Track current time off the native element so we keep working even
  // if Plyr fails to mount.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = (): void => setCurrentTime(el.currentTime);
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, []);

  const currentChapterIndex = useMemo(() => {
    const markers = validated.chapter_markers;
    if (markers.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < markers.length; i += 1) {
      const marker = markers[i];
      if (!marker) continue;
      if (currentTime >= marker.at) idx = i;
    }
    return idx;
  }, [validated.chapter_markers, currentTime]);

  const seekToChapter = useCallback(
    (index: number): void => {
      const marker = validated.chapter_markers[index];
      const el = audioRef.current;
      if (!marker || !el) return;
      el.currentTime = marker.at;
      setCurrentTime(marker.at);
    },
    [validated.chapter_markers],
  );

  const onSelectSpeed = useCallback((rate: number): void => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  const onShareWhatsapp = useCallback((): void => {
    const link = shareUrl ?? (typeof window !== 'undefined' ? window.location.href : '');
    const message = `${t.defaultShareCopy}: ${validated.title} — ${link}`;
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  }, [shareUrl, t.defaultShareCopy, validated.title]);

  return (
    <article
      data-testid="report-player"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">{validated.title}</h2>
          <p className="text-badge text-neutral-500">{validated.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <SpeedSelector
            label={t.speed}
            speeds={PLAYBACK_SPEEDS}
            current={playbackRate}
            onChange={onSelectSpeed}
          />
          <a
            href={validated.audio_url}
            download
            aria-label={t.download}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-neutral-300 hover:bg-warning-subtle/20 hover:text-warning"
          >
            <Download className="h-3.5 w-3.5" />
            {t.download}
          </a>
          <button
            type="button"
            onClick={onShareWhatsapp}
            aria-label={t.shareWhatsapp}
            className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-subtle/20 px-2 py-1 text-xs text-success hover:bg-success-subtle/40"
          >
            <Share2 className="h-3.5 w-3.5" />
            {t.shareWhatsapp}
          </button>
        </div>
      </header>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="flex-1">
          <audio
            ref={audioRef}
            data-testid="report-player-audio"
            className="plyr--borjie"
            preload="metadata"
            src={validated.audio_url}
          >
            <track
              kind="captions"
              src={validated.transcript_url}
              srcLang={lang}
              label={t.transcript}
              default
            />
          </audio>
        </div>
        <ChapterList
          chapters={validated.chapter_markers}
          currentIndex={currentChapterIndex}
          onSeek={seekToChapter}
          heading={t.chapters}
          previousLabel={t.previousChapter}
          nextLabel={t.nextChapter}
        />
      </div>
      <SyncedTranscript
        transcriptUrl={validated.transcript_url}
        currentTime={currentTime}
        heading={t.transcript}
      />
    </article>
  );
}

interface SpeedSelectorProps {
  readonly label: string;
  readonly speeds: ReadonlyArray<number>;
  readonly current: number;
  readonly onChange: (rate: number) => void;
}

/**
 * Compact speed selector — `<select>` for keyboard accessibility.
 * Plyr's own speed menu also lives in the controls strip; this
 * surface mirrors it at the header level so it is visible without
 * opening Plyr's settings popover.
 */
function SpeedSelector({ label, speeds, current, onChange }: SpeedSelectorProps) {
  return (
    <label className="inline-flex items-center gap-1 text-xs text-neutral-400">
      <span className="sr-only">{label}</span>
      <select
        data-testid="speed-selector"
        value={current}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        aria-label={label}
        className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
      >
        {speeds.map((speed) => (
          <option key={speed} value={speed}>
            {speed}x
          </option>
        ))}
      </select>
    </label>
  );
}
