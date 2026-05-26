'use client';

import { useEffect, useRef } from 'react';
import type { ChapterMarker } from './report-player-schema';

interface ChapterListProps {
  readonly chapters: ReadonlyArray<ChapterMarker>;
  readonly currentIndex: number;
  readonly onSeek: (index: number) => void;
  readonly heading: string;
  readonly previousLabel: string;
  readonly nextLabel: string;
}

/**
 * Keyboard-navigable chapter list rendered to the right of the player.
 *
 * Each chapter is a `<button>`; ArrowLeft / ArrowRight jump between
 * chapters once focus is inside the list. ArrowUp / ArrowDown also
 * navigate so the list works with screen-reader cursor keys too.
 *
 * `aria-current="true"` is set on the active chapter so AT users hear
 * the change as the player crosses a marker.
 */
export function ChapterList({
  chapters,
  currentIndex,
  onSeek,
  heading,
  previousLabel,
  nextLabel,
}: ChapterListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-chapter-index="${currentIndex}"]`,
    );
    // scrollIntoView is missing under jsdom (no layout engine); guard
    // with a runtime typeof so tests do not blow up on the call.
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (index > 0) onSeek(index - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (index < chapters.length - 1) onSeek(index + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek(chapters.length - 1);
    }
  };

  return (
    <aside
      aria-label={heading}
      className="flex w-full flex-col rounded-md border border-border bg-surface md:w-56"
    >
      <header className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {heading}
      </header>
      <ul ref={listRef} className="max-h-56 space-y-1 overflow-y-auto px-2 py-2">
        {chapters.map((chapter, index) => {
          const active = index === currentIndex;
          return (
            <li key={`${chapter.at}-${chapter.label}`}>
              <button
                type="button"
                data-chapter-index={index}
                data-testid={`chapter-button-${index}`}
                aria-current={active ? 'true' : undefined}
                aria-label={`${chapter.label} (${formatTimestamp(chapter.at)})`}
                onClick={() => onSeek(index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-warning ${
                  active
                    ? 'bg-warning-subtle/30 text-warning'
                    : 'text-neutral-300 hover:bg-background'
                }`}
              >
                <span className="truncate">{chapter.label}</span>
                <span className="ml-2 font-mono text-[11px] text-neutral-500">
                  {formatTimestamp(chapter.at)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-neutral-500">
        <span>{previousLabel}: ←</span>
        <span>{nextLabel}: →</span>
      </footer>
    </aside>
  );
}

/**
 * Format seconds as `m:ss` (or `h:mm:ss` past one hour).
 */
function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}
