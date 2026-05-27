'use client';

/**
 * JarvisConsole — minimal chat console wired into the platform-tier
 * Jarvis surface. Uses the shared `useJarvis` hook and the
 * `createJarvisClient` factory from the api-sdk so every Borjie
 * frontend can reuse the same primitive.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBorjieClient, createJarvisClient } from '@borjie/api-sdk';
import {
  MicButton,
  createWebSpeechAudioPort,
  useJarvis,
  useJarvisStream,
  type VoiceAudioPort,
} from '@borjie/chat-ui';
// C3-COORD: AdaptiveRenderer rendering for TOOL_RESULT.uiPart
// AdaptiveRenderer dispatches AgUiUiPart payloads (chart-vega,
// data-table, timeline, kpi-grid, prefill-form, approval, workflow,
// map, calendar, file-preview) to the right primitive. Wired below
// in the message stack — once C1 lands the AG-UI client hook the
// `(t as any).uiParts` cast becomes a typed read.
import { AdaptiveRenderer } from '@/lib/genui';
import type { AgUiUiPart } from '@/lib/genui';

// Build-time guard: production deployments MUST set
// NEXT_PUBLIC_API_GATEWAY_URL. The localhost fallback exists only so a
// developer running `next dev` against the local gateway gets a working
// console without explicit env wiring. Any non-development NODE_ENV
// without the env var fails loud at module load.
function resolveGatewayUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_GATEWAY_URL is required in production builds of admin-web.',
    );
  }
  return 'http://localhost:4000';
}
const DEFAULT_GATEWAY = resolveGatewayUrl();

// UI-side cap. The gateway enforces 10 / 4 MiB per attachment as the
// hard server-side limit; the console intentionally caps lower so an HQ
// operator does not staple a presentation deck onto a chat turn.
const MAX_IMAGES_PER_TURN = 5;
const ALLOWED_IMAGE_MIME = 'image/png,image/jpeg,image/gif,image/webp';

export function JarvisConsole(): JSX.Element {
  const [draft, setDraft] = useState('');
  const [threadId] = useState(() => `hq_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`);
  const [pendingImages, setPendingImages] = useState<ReadonlyArray<File>>([]);
  // Default to streaming for visibly faster UX; the toggle lets ops
  // compare wire-level streaming against the single-shot /think path.
  const [mode, setMode] = useState<'stream' | 'single-shot'>('stream');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const client = useMemo(
    () =>
      createJarvisClient(
        createBorjieClient({
          baseUrl: DEFAULT_GATEWAY,
          // Bearer comes from the existing Supabase auth session in the
          // page wrapper; the gateway middleware also accepts an
          // X-API-Key for service-to-service in dev.
          bearerToken: () => readBearerFromCookie(),
        }),
        'platform',
      ),
    [],
  );

  // Voice port — instantiated only on the client (Web Speech needs `window`).
  const [audioPort, setAudioPort] = useState<VoiceAudioPort | null>(null);
  useEffect(() => {
    setAudioPort(createWebSpeechAudioPort());
  }, []);

  const {
    turns: singleShotTurns,
    status: singleShotStatus,
    error: singleShotError,
    persona,
    think,
    thinkWithAttachments,
    reset: singleShotReset,
    isListening,
    startListening,
    stopListening,
  } = useJarvis({
    client,
    threadId,
    defaultStakes: 'medium',
    defaultTier: 'industry',
    ...(audioPort ? { voice: { audio: audioPort, speakReplies: true } } : {}),
  });

  // Streaming variant — same surface client; visibly faster UX because
  // each `delta` event is rendered as it arrives rather than waiting
  // for the full /think round-trip.
  const {
    turns: streamTurns,
    status: streamStatus,
    error: streamError,
    startStream,
    abort: abortStream,
    reset: streamReset,
  } = useJarvisStream({
    client,
    threadId,
    defaultStakes: 'medium',
    defaultTier: 'industry',
  });

  const isStreaming = mode === 'stream';
  const turns = isStreaming ? streamTurns : singleShotTurns;
  const error = isStreaming ? streamError : singleShotError;
  const isThinking = isStreaming
    ? streamStatus === 'streaming'
    : singleShotStatus === 'thinking';
  const reset = isStreaming ? streamReset : singleShotReset;
  const streamPersona = streamTurns
    .slice()
    .reverse()
    .find((t) => t.role === 'assistant')?.persona;
  const visiblePersona = isStreaming
    ? (streamPersona ?? persona)
    : persona;

  function onPickImages(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPendingImages((prev) => {
      // Append, then truncate to the per-turn cap. Existing images are
      // preserved and de-duped by name+size so the same file picked
      // twice doesn't double up.
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged: File[] = [...prev];
      for (const f of files) {
        const k = `${f.name}::${f.size}`;
        if (!seen.has(k)) {
          merged.push(f);
          seen.add(k);
        }
      }
      return merged.slice(0, MAX_IMAGES_PER_TURN);
    });
    // Reset the input so picking the same file again still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeImage(idx: number): void {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const text = draft.trim();
    if (isThinking) return;
    if (!text && pendingImages.length === 0) return;
    setDraft('');
    const images = pendingImages;
    setPendingImages([]);
    if (isStreaming) {
      await startStream(text, images.length > 0 ? images : undefined);
      return;
    }
    if (images.length > 0) {
      await thinkWithAttachments(text, images);
    } else {
      await think(text);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {visiblePersona ? (
          <div className="rounded border border-border bg-surface-sunken px-4 py-2 text-sm text-muted-foreground">
            {visiblePersona.displayName} · {visiblePersona.firstPersonNoun === 'we' ? 'plural voice' : 'singular voice'}
          </div>
        ) : <span />}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Mode</span>
          <button
            type="button"
            onClick={() => setMode('stream')}
            className={
              mode === 'stream'
                ? 'rounded border border-primary bg-primary px-2 py-1 text-primary-foreground'
                : 'rounded border border-border bg-surface px-2 py-1 text-foreground'
            }
            aria-pressed={mode === 'stream'}
          >
            stream
          </button>
          <button
            type="button"
            onClick={() => setMode('single-shot')}
            className={
              mode === 'single-shot'
                ? 'rounded border border-primary bg-primary px-2 py-1 text-primary-foreground'
                : 'rounded border border-border bg-surface px-2 py-1 text-foreground'
            }
            aria-pressed={mode === 'single-shot'}
          >
            single-shot
          </button>
        </div>
      </div>

      <div className="flex min-h-console-pane flex-col gap-3 rounded border border-border bg-surface p-4 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask Nyumba Mind anything about the platform — collection trends, vacancy drift,
            arrears patterns. Every claim is grounded in DP-aggregate evidence.
          </p>
        ) : (
          turns.map((t) => {
            // Both turn shapes overlap on `id`, `role`, `text`. The
            // streaming turn carries `finalDecision`; the single-shot
            // turn carries `decision`. Coalesce so the renderer stays
            // mode-agnostic.
            const tt = t as {
              decision?: any;
              finalDecision?: any;
              // C3-COORD: AdaptiveRenderer rendering for TOOL_RESULT.uiPart
              // C1 populates `uiParts` from AG-UI `tool-output-available`
              // events whose payload is an AgUiUiPart. Cast until the
              // canonical turn type ships from chat-ui.
              uiParts?: ReadonlyArray<AgUiUiPart>;
            } & typeof t;
            const decision = tt.finalDecision ?? tt.decision;
            const uiParts: ReadonlyArray<AgUiUiPart> = tt.uiParts ?? [];
            return (
              <div
                key={t.id}
                className={
                  t.role === 'user'
                    ? 'self-end max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'self-start max-w-[80%] rounded-lg bg-surface-sunken px-3 py-2 text-sm text-foreground'
                }
              >
                <div className="whitespace-pre-wrap">{t.text}</div>
                {t.role === 'assistant' && uiParts.length > 0 ? (
                  // C3-COORD: AdaptiveRenderer rendering for TOOL_RESULT.uiPart
                  // Render each typed UiPart through the AdaptiveRenderer.
                  // Each primitive Zod-validates its own payload at the
                  // render boundary; chart-vega additionally ajv-checks
                  // the spec before handing it to react-vega.
                  <div className="mt-2 flex flex-col gap-2">
                    {uiParts.map((part, idx) => (
                      <AdaptiveRenderer key={`${t.id}-uip-${idx}`} uiPart={part} />
                    ))}
                  </div>
                ) : null}
                {t.role === 'assistant' && decision?.confidence ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    confidence {(decision.confidence.overall * 100).toFixed(0)}%
                    {decision.kind === 'softened' ? ' · softened' : ''}
                    {decision.kind === 'refusal' ? ' · refused' : ''}
                  </div>
                ) : null}
                {t.role === 'assistant' &&
                decision?.citations &&
                decision.citations.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {decision.citations.map((cite: any) => (
                      <li
                        key={cite.id}
                        className="rounded border border-border bg-surface px-2 py-1"
                      >
                        <span className="font-medium text-foreground">
                          {cite.label}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          · grounded {(cite.confidence * 100).toFixed(0)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
        {isThinking ? (
          <div className="self-start text-xs text-muted-foreground italic">
            {isStreaming ? 'streaming…' : 'thinking…'}
          </div>
        ) : null}
        {error ? (
          <div className="self-start text-xs text-destructive">error: {error}</div>
        ) : null}
      </div>

      {pendingImages.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pendingImages.map((f, i) => (
            <span
              key={`${f.name}_${f.size}_${i}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-sunken px-3 py-1 text-xs text-foreground"
            >
              <span className="max-w-meta-rail truncate">{f.name}</span>
              <button
                type="button"
                onClick={() => removeImage(i)}
                aria-label={`Remove ${f.name}`}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isListening ? 'Listening…' : 'Ask Nyumba Mind…'}
          disabled={isThinking}
          className="flex-1 rounded border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_MIME}
          multiple
          onChange={onPickImages}
          className="hidden"
          aria-label="Attach images"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isThinking || pendingImages.length >= MAX_IMAGES_PER_TURN}
          aria-label="Attach images"
          title={
            pendingImages.length >= MAX_IMAGES_PER_TURN
              ? `Up to ${MAX_IMAGES_PER_TURN} images per turn`
              : 'Attach images (lease scan, property photo, damage assessment)'
          }
          className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50"
        >
          Image
        </button>
        {audioPort?.sttSupported ? (
          <MicButton
            isListening={isListening}
            onStart={startListening}
            onStop={stopListening}
            disabled={isThinking}
          />
        ) : null}
        <button
          type="submit"
          disabled={
            isThinking ||
            (!draft.trim() && pendingImages.length === 0)
          }
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
        {isStreaming && isThinking ? (
          <button
            type="button"
            onClick={abortStream}
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            Abort
          </button>
        ) : null}
        <button
          type="button"
          onClick={reset}
          disabled={turns.length === 0}
          className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-50"
        >
          Clear
        </button>
      </form>
    </div>
  );
}

function readBearerFromCookie(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/sb-access-token=([^;]+)/);
  return m ? decodeURIComponent(m[1] ?? '') : '';
}
