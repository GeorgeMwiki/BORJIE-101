'use client';

import { useEffect, useMemo, useState } from 'react';

export interface TranscriptCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface SyncedTranscriptProps {
  readonly transcriptUrl: string;
  readonly currentTime: number;
  readonly heading: string;
}

/**
 * Renders a synced transcript beneath the player. Fetches a WebVTT
 * file from `transcriptUrl` once, parses it into cue chunks, and on
 * every `timeupdate` from the parent player highlights the active
 * word.
 *
 * Highlighting strategy:
 *  - find the active cue (covers the current time)
 *  - within that cue, split text on whitespace, distribute time
 *    proportionally to word count, and mark the matching index as
 *    highlighted. This is approximate (per-word VTT timing would be
 *    more precise) but good enough for narrations where the audio is
 *    rendered server-side from the same script.
 */
export function SyncedTranscript({
  transcriptUrl,
  currentTime,
  heading,
}: SyncedTranscriptProps) {
  const cues = useTranscriptCues(transcriptUrl);

  const activeCueIndex = useMemo(() => {
    if (!cues) return -1;
    return cues.findIndex(
      (cue) => currentTime >= cue.start && currentTime < cue.end,
    );
  }, [cues, currentTime]);

  return (
    <section aria-label={heading} className="rounded-md border border-border bg-background px-4 py-3">
      <header className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {heading}
      </header>
      <div
        data-testid="transcript-body"
        className="max-h-72 overflow-y-auto text-sm leading-relaxed text-neutral-300"
      >
        {cues === null ? (
          <p className="text-xs text-neutral-500">…</p>
        ) : (
          cues.map((cue, cueIndex) => (
            <TranscriptCueLine
              key={`${cue.start}-${cueIndex}`}
              cue={cue}
              currentTime={currentTime}
              active={cueIndex === activeCueIndex}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface TranscriptCueLineProps {
  readonly cue: TranscriptCue;
  readonly currentTime: number;
  readonly active: boolean;
}

function TranscriptCueLine({ cue, currentTime, active }: TranscriptCueLineProps) {
  const words = cue.text.split(/\s+/).filter(Boolean);
  const duration = Math.max(cue.end - cue.start, 0.001);
  const perWord = duration / Math.max(words.length, 1);
  const elapsedInCue = Math.max(0, currentTime - cue.start);
  const activeWordIndex = active
    ? Math.min(words.length - 1, Math.floor(elapsedInCue / perWord))
    : -1;

  return (
    <p className={`mb-2 ${active ? 'text-foreground' : ''}`}>
      {words.map((word, wordIndex) => (
        <span
          key={`${wordIndex}-${word}`}
          data-active-word={wordIndex === activeWordIndex ? 'true' : undefined}
          className={
            wordIndex === activeWordIndex
              ? 'rounded bg-warning-subtle/40 px-0.5 text-warning'
              : ''
          }
        >
          {word}{' '}
        </span>
      ))}
    </p>
  );
}

/**
 * Fetch + parse a WebVTT transcript. Returns null while loading and an
 * empty array on parse failure (rather than throwing — a missing
 * transcript is non-fatal for the player).
 */
function useTranscriptCues(url: string): ReadonlyArray<TranscriptCue> | null {
  const [cues, setCues] = useState<ReadonlyArray<TranscriptCue> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!cancelled) setCues(parseVtt(text));
      })
      .catch(() => {
        if (!cancelled) setCues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return cues;
}

/**
 * Minimal WebVTT parser — handles the timestamp + text body lines we
 * emit from the narration worker. We intentionally do not pull in a
 * full VTT lib for this; the format is simple enough to parse inline.
 */
export function parseVtt(text: string): ReadonlyArray<TranscriptCue> {
  const lines = text.split(/\r?\n/);
  const cues: TranscriptCue[] = [];
  let current: { start: number; end: number; lines: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'WEBVTT') continue;
    const tsMatch = line.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?\.\d{1,3})/,
    );
    if (tsMatch) {
      if (current) {
        cues.push({ start: current.start, end: current.end, text: current.lines.join(' ') });
      }
      current = {
        start: parseTimestamp(tsMatch[1] ?? '0:00.000'),
        end: parseTimestamp(tsMatch[2] ?? '0:00.000'),
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    cues.push({ start: current.start, end: current.end, text: current.lines.join(' ') });
  }
  return cues;
}

function parseTimestamp(stamp: string): number {
  const parts = stamp.split(':');
  const seconds = parseFloat(parts[parts.length - 1] ?? '0');
  const minutes = parts.length >= 2 ? parseInt(parts[parts.length - 2] ?? '0', 10) : 0;
  const hours = parts.length >= 3 ? parseInt(parts[parts.length - 3] ?? '0', 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}
