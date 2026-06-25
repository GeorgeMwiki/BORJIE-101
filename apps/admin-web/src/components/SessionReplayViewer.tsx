'use client';

/**
 * SessionReplayViewer — Central Command Phase B (B5).
 *
 * Renders an rrweb-player on top of the chunked events fetched from the
 * gateway's session-replay router. Admin-gated by the page wrapper.
 *
 * UI:
 *   - Session summary (id, first/last capture, duration, chunk count)
 *   - Player frame (rrweb-player; lazy-loaded so SSR doesn't drag in
 *     the heavy DOM-mutation runtime). When rrweb-player is not
 *     installed, an honest "replay unavailable" state is shown instead
 *     of a silent blank div.
 *   - Chunk inventory with bytes + event count per chunk
 *
 * The events stream is read SEPARATELY from the sensorium 14-event log;
 * the brain never sees these bytes. (See `.planning/research/central-
 * command/2025-brain-as-os.md`.)
 *
 * Phase C follow-ups (#33):
 *   - Sensorium event overlay (join `sensorium_event_log` by timestamp)
 *   - Filter / search across sessions (free text + event-type facet)
 *   - Bookmarkable timestamps + share links
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { pickByLocale, useLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';
import { toCatalogError } from '@/lib/api-client';

interface ChunkRow {
  readonly id: string;
  readonly sessionId: string;
  readonly sequenceNumber: number;
  readonly eventCount: number;
  readonly byteSize: number;
  readonly capturedAt: string;
  readonly storageUri: string;
}

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { code: string; message?: string };
}

export interface SessionReplayViewerProps {
  readonly sessionId: string;
  readonly apiBaseUrl?: string;
  /** Server-resolved locale seed so the first paint matches the page chrome. */
  readonly initialLocale?: Locale;
}

export function SessionReplayViewer({
  sessionId,
  apiBaseUrl,
  initialLocale,
}: SessionReplayViewerProps) {
  const locale = useLocale(initialLocale);
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [events, setEvents] = useState<unknown[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [playerUnavailable, setPlayerUnavailable] = useState<boolean>(false);
  const playerHostRef = useRef<HTMLDivElement | null>(null);

  const base = useMemo(
    () =>
      apiBaseUrl ??
      (typeof process !== 'undefined' && process.env
        ? process.env.NEXT_PUBLIC_API_BASE_URL ?? ''
        : ''),
    [apiBaseUrl],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const listRes = await fetch(
          `${base.replace(/\/$/, '')}/api/v1/session-replay/sessions/${encodeURIComponent(sessionId)}/chunks`,
          { credentials: 'include' },
        );
        if (!listRes.ok) {
          throw new Error(`list failed: ${listRes.status}`);
        }
        const listBody = (await listRes.json()) as ApiEnvelope<{
          chunks: ChunkRow[];
        }>;
        if (!listBody.success || !listBody.data) {
          throw new Error(listBody.error?.message ?? 'list returned error');
        }
        const orderedChunks = [...listBody.data.chunks].sort(
          (a, b) => a.sequenceNumber - b.sequenceNumber,
        );
        if (cancelled) return;
        setChunks(orderedChunks);

        // Fetch each chunk's payload sequentially; for typical sessions
        // (≤ 100 chunks) this is fast enough and conserves S3 budget.
        const accumulated: unknown[] = [];
        for (const c of orderedChunks) {
          if (cancelled) return;
          const blobRes = await fetch(
            `${base.replace(/\/$/, '')}/api/v1/session-replay/sessions/${encodeURIComponent(sessionId)}/chunks/${encodeURIComponent(c.id)}`,
            { credentials: 'include' },
          );
          if (!blobRes.ok) {
            // Chunk fetch failed — skip silently; the chunk inventory
            // table will still show the chunk's metadata.
            continue;
          }
          const text = await blobRes.text();
          try {
            const decoded = JSON.parse(text) as unknown[];
            if (Array.isArray(decoded)) accumulated.push(...decoded);
          } catch {
            // Unparseable chunk — skip silently.
          }
        }
        if (!cancelled) setEvents(accumulated);
      } catch (err) {
        if (!cancelled) {
          setError(localizeApiError(toCatalogError(err), locale));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, base]);

  // Lazy-load rrweb-player + render once events are available.
  // When the package is not installed (expected until the dep is
  // added to package.json + pnpm-installed) we surface an honest
  // "replay unavailable" state rather than a silent blank div.
  useEffect(() => {
    if (events.length === 0) return;
    if (!playerHostRef.current) return;
    let destroyed = false;
    let teardown: (() => void) | null = null;
    void (async () => {
      try {
        // Indirect import so the bundler does NOT static-resolve
        // rrweb-player at build time — the dep may not be installed yet.
        const playerModuleId = 'rrweb-player';
        // @ts-ignore — runtime-only dep; absence is expected until installed.
        const mod = await import(/* @vite-ignore */ playerModuleId);
        if (destroyed || !playerHostRef.current) return;
        const PlayerCtor =
          (mod as { default?: unknown }).default ??
          (mod as Record<string, unknown>).Player ??
          null;
        if (typeof PlayerCtor === 'function') {
          // rrweb-player has a Svelte-style constructor signature.
          interface PlayerInstance {
            $destroy?: () => void;
          }
          type PlayerNew = new (opts: {
            target: HTMLElement;
            props: {
              events: ReadonlyArray<unknown>;
              autoPlay?: boolean;
              showController?: boolean;
            };
          }) => PlayerInstance;
          const instance = new (PlayerCtor as PlayerNew)({
            target: playerHostRef.current,
            props: {
              events,
              autoPlay: false,
              showController: true,
            },
          });
          teardown = () => {
            try {
              if (instance && typeof instance.$destroy === 'function') {
                instance.$destroy();
              }
            } catch {
              /* swallow */
            }
          };
        } else {
          // Module loaded but no usable constructor found — mark unavailable.
          if (!destroyed) setPlayerUnavailable(true);
        }
      } catch {
        // Package not installed or failed to load — show honest state.
        if (!destroyed) setPlayerUnavailable(true);
      }
    })();
    return () => {
      destroyed = true;
      if (teardown) teardown();
    };
  }, [events]);

  if (loading) {
    return (
      <div className="text-sm text-neutral-400">
        {pickByLocale(locale, {
          en: 'Loading replay…',
          sw: 'Inapakia uchezaji…',
        })}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-warning bg-warning/10 p-4 text-sm text-warning">
        {pickByLocale(locale, {
          en: 'Replay load failed: ',
          sw: 'Upakiaji wa uchezaji umeshindwa: ',
        })}
        {error}
      </div>
    );
  }
  if (chunks.length === 0) {
    return (
      <div className="text-sm text-neutral-400">
        {pickByLocale(locale, {
          en: 'No chunks recorded for this session.',
          sw: 'Hakuna vipande vilivyorekodiwa kwa kipindi hiki.',
        })}
      </div>
    );
  }

  const firstCapturedAt = chunks[0]?.capturedAt ?? '';
  const lastCapturedAt = chunks[chunks.length - 1]?.capturedAt ?? '';
  const totalBytes = chunks.reduce((n, c) => n + c.byteSize, 0);
  const totalEvents = chunks.reduce((n, c) => n + c.eventCount, 0);

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-2 gap-4 text-sm text-neutral-300">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {pickByLocale(locale, { en: 'Session', sw: 'Kipindi' })}
          </div>
          <div className="font-mono break-all">{sessionId}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {pickByLocale(locale, { en: 'Duration', sw: 'Muda' })}
          </div>
          <div>
            {formatRange(firstCapturedAt, lastCapturedAt)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {pickByLocale(locale, { en: 'Chunks', sw: 'Vipande' })}
          </div>
          <div>{chunks.length}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            {pickByLocale(locale, { en: 'Events / bytes', sw: 'Matukio / baiti' })}
          </div>
          <div>
            {totalEvents.toLocaleString()}{' '}
            {pickByLocale(locale, { en: 'events', sw: 'matukio' })} ·{' '}
            {formatBytes(totalBytes)}
          </div>
        </div>
      </header>

      <section
        aria-label={pickByLocale(locale, {
          en: 'rrweb replay player',
          sw: 'Kichezaji cha uchezaji cha rrweb',
        })}
        className="rounded-md border border-border bg-surface-sunken overflow-hidden"
        style={{ minHeight: 480 }}
      >
        {playerUnavailable ? (
          <div
            className="flex h-full min-h-[480px] flex-col items-center justify-center gap-2 p-6 text-center"
            data-testid="session-replay-unavailable"
          >
            <p className="text-sm font-medium text-neutral-300">
              {pickByLocale(locale, {
                en: 'Replay player unavailable',
                sw: 'Kichezaji cha uchezaji hakipatikani',
              })}
            </p>
            <p className="max-w-sm text-xs text-neutral-500">
              {pickByLocale(locale, {
                en: 'The rrweb-player package is not installed in this environment. Raw events are captured and the chunk inventory below is accurate — playback requires ',
                sw: 'Kifurushi cha rrweb-player hakijasakinishwa katika mazingira haya. Matukio ghafi yamenaswa na orodha ya vipande hapa chini ni sahihi — uchezaji unahitaji ',
              })}
              <code className="rounded bg-neutral-800 px-1 py-0.5">
                rrweb-player
              </code>{' '}
              {pickByLocale(locale, {
                en: 'to be added to the admin-web dependencies.',
                sw: 'kuongezwa kwenye tegemezi za admin-web.',
              })}
            </p>
          </div>
        ) : (
          <div ref={playerHostRef} data-testid="session-replay-player" />
        )}
      </section>

      <section
        aria-label={pickByLocale(locale, {
          en: 'Chunk inventory',
          sw: 'Orodha ya vipande',
        })}
        className="space-y-2"
      >
        <h2 className="text-sm font-semibold text-foreground">
          {pickByLocale(locale, {
            en: 'Chunk inventory',
            sw: 'Orodha ya vipande',
          })}
        </h2>
        <table className="w-full text-xs text-neutral-300 border-collapse">
          <thead className="text-neutral-500 uppercase tracking-wider">
            <tr>
              <th className="text-left py-1 pr-3">
                {pickByLocale(locale, { en: 'Seq', sw: 'Mfululizo' })}
              </th>
              <th className="text-left py-1 pr-3">
                {pickByLocale(locale, { en: 'Captured at', sw: 'Imenaswa saa' })}
              </th>
              <th className="text-left py-1 pr-3">
                {pickByLocale(locale, { en: 'Events', sw: 'Matukio' })}
              </th>
              <th className="text-left py-1 pr-3">
                {pickByLocale(locale, { en: 'Bytes', sw: 'Baiti' })}
              </th>
              <th className="text-left py-1 pr-3">
                {pickByLocale(locale, { en: 'Storage URI', sw: 'URI ya hifadhi' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {chunks.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-1 pr-3 font-mono">{c.sequenceNumber}</td>
                <td className="py-1 pr-3">{c.capturedAt}</td>
                <td className="py-1 pr-3">{c.eventCount}</td>
                <td className="py-1 pr-3">{formatBytes(c.byteSize)}</td>
                <td className="py-1 pr-3 font-mono break-all">{c.storageUri}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRange(first: string, last: string): string {
  if (!first || !last) return '—';
  const a = new Date(first).getTime();
  const b = new Date(last).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const ms = Math.max(0, b - a);
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}
