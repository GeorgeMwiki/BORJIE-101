/**
 * useJarvisStream — React hook that consumes the per-user Jarvis SSE
 * stream from `@borjie/api-sdk`.
 *
 * Sibling of `useJarvis` (single-shot `think()` flow). The streaming
 * variant gives the user visibly faster feedback because each `delta`
 * event is appended to the in-flight assistant turn as it arrives.
 *
 * The hook accumulates each in-flight assistant turn locally; the
 * gateway already records every turn through the kernel's audit chain.
 *
 * Multimodal inputs are supported the same way as `useJarvis`: the
 * caller passes browser `File`s, the hook reads each as base64 and
 * packs a `JarvisAttachment[]` before calling `client.stream(...)`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  JarvisAttachment,
  JarvisDecision,
  JarvisStakes,
  JarvisStreamConfidence,
  JarvisStreamEvent,
  JarvisStreamPersona,
  JarvisStreamUiPart,
  JarvisSurfaceClient,
  JarvisThinkRequest,
} from '@borjie/api-sdk';

export type { JarvisStreamUiPart };

export interface JarvisStreamTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  /** Accumulating reply text (for assistant turns). */
  readonly text: string;
  /** Accumulating extended-thinking text (for assistant turns). */
  readonly thinking?: string;
  readonly persona?: JarvisStreamPersona;
  readonly confidence?: JarvisStreamConfidence;
  readonly finalDecision?: JarvisDecision;
  /**
   * Structured UI parts the MD emitted during this turn — aggregated
   * from `tool_output_available` SSE events and rendered by the
   * `AdaptiveRenderer` in `@borjie/genui`.
   */
  readonly uiParts?: ReadonlyArray<JarvisStreamUiPart>;
  readonly at: string;
}

export type JarvisStreamStatus = 'idle' | 'streaming' | 'error';

export interface UseJarvisStreamOptions {
  readonly client: JarvisSurfaceClient;
  /** Stable thread id; reuse across renders so the kernel keeps memory. */
  readonly threadId: string;
  /** Default stakes for stream calls; can be overridden per call. */
  readonly defaultStakes?: JarvisStakes;
  /** Default tier; default = surface's tier (set by the gateway). */
  readonly defaultTier?: JarvisThinkRequest['tier'];
}

export interface UseJarvisStreamReturn {
  readonly turns: ReadonlyArray<JarvisStreamTurn>;
  readonly status: JarvisStreamStatus;
  readonly error: string | null;
  startStream(
    message: string,
    attachments?: ReadonlyArray<File>,
    override?: Partial<JarvisThinkRequest>,
  ): Promise<void>;
  abort(): void;
  reset(): void;
}

export function useJarvisStream(opts: UseJarvisStreamOptions): UseJarvisStreamReturn {
  const [turns, setTurns] = useState<ReadonlyArray<JarvisStreamTurn>>([]);
  const [status, setStatus] = useState<JarvisStreamStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const counter = useRef(0);
  const handleRef = useRef<{ abort(): void } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      handleRef.current?.abort();
    };
  }, []);

  const nextId = useCallback((): string => {
    counter.current += 1;
    return `s_${Date.now()}_${counter.current}`;
  }, []);

  const abort = useCallback((): void => {
    handleRef.current?.abort();
    handleRef.current = null;
  }, []);

  const reset = useCallback((): void => {
    abort();
    setTurns([]);
    setStatus('idle');
    setError(null);
  }, [abort]);

  const startStream = useCallback(
    async (
      message: string,
      attachments?: ReadonlyArray<File>,
      override?: Partial<JarvisThinkRequest>,
    ): Promise<void> => {
      const trimmed = message.trim();
      const hasAttachments = (attachments?.length ?? 0) > 0;
      if (!trimmed && !hasAttachments) return;

      // Cancel any prior in-flight stream before starting a new one.
      handleRef.current?.abort();
      handleRef.current = null;

      const text = trimmed.length > 0
        ? trimmed
        : 'Please review the attached image(s).';

      // Append the user turn synchronously so the UI flips to
      // "streaming" with the user's message visible.
      const captions = (attachments ?? []).map((f) => f.name).filter(Boolean).join(', ');
      const userTurn: JarvisStreamTurn = {
        id: nextId(),
        role: 'user',
        text: captions ? `${text}\n\n[Attached: ${captions}]` : text,
        at: new Date().toISOString(),
      };
      const assistantTurnId = nextId();
      const assistantTurn: JarvisStreamTurn = {
        id: assistantTurnId,
        role: 'assistant',
        text: '',
        at: new Date().toISOString(),
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setStatus('streaming');
      setError(null);

      // Pack attachments → base64.
      let packed: ReadonlyArray<JarvisAttachment> = [];
      if (hasAttachments) {
        try {
          packed = await Promise.all((attachments ?? []).map(fileToJarvisAttachment));
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (!mountedRef.current) return;
          setStatus('error');
          setError(m);
          return;
        }
      }

      const req: JarvisThinkRequest = {
        threadId: opts.threadId,
        userMessage: text,
        stakes: override?.stakes ?? opts.defaultStakes ?? 'medium',
        ...(override?.tier
          ? { tier: override.tier }
          : opts.defaultTier
            ? { tier: opts.defaultTier }
            : {}),
        ...(typeof override?.requireJudge === 'boolean'
          ? { requireJudge: override.requireJudge }
          : {}),
        ...(packed.length > 0 ? { attachments: packed } : {}),
      };

      const handle = opts.client.stream(req);
      handleRef.current = handle;

      try {
        for await (const ev of handle.events()) {
          if (!mountedRef.current) return;
          applyEvent(setTurns, assistantTurnId, ev, setStatus, setError);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const m = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setError(m);
      } finally {
        if (handleRef.current === handle) handleRef.current = null;
        if (mountedRef.current) {
          // If we exited cleanly without seeing `done`, leave the
          // status as whatever the last event set it to.
          setStatus((prev) => (prev === 'streaming' ? 'idle' : prev));
        }
      }
    },
    [nextId, opts.client, opts.defaultStakes, opts.defaultTier, opts.threadId],
  );

  return useMemo(
    () => ({ turns, status, error, startStream, abort, reset }),
    [turns, status, error, startStream, abort, reset],
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function applyEvent(
  setTurns: React.Dispatch<React.SetStateAction<ReadonlyArray<JarvisStreamTurn>>>,
  assistantId: string,
  ev: JarvisStreamEvent,
  setStatus: React.Dispatch<React.SetStateAction<JarvisStreamStatus>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  switch (ev.kind) {
    case 'turn_start':
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId ? { ...t, persona: ev.persona } : t,
        ),
      );
      return;
    case 'delta':
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId ? { ...t, text: t.text + ev.text } : t,
        ),
      );
      return;
    case 'thinking':
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId
            ? { ...t, thinking: (t.thinking ?? '') + ev.text }
            : t,
        ),
      );
      return;
    case 'gate':
      // Gate verdicts are surfaced via finalDecision on `done`; we
      // don't bubble them onto the rendering buffer separately yet.
      return;
    case 'confidence':
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId ? { ...t, confidence: ev.vector } : t,
        ),
      );
      return;
    case 'tool_output_available':
      // Append the structured ui-part to the turn's uiParts[]. The
      // AdaptiveRenderer in @borjie/genui renders the array.
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId
            ? { ...t, uiParts: [...(t.uiParts ?? []), ev.uiPart] }
            : t,
        ),
      );
      return;
    case 'done':
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId
            ? {
                ...t,
                text:
                  t.text ||
                  ev.decision.text ||
                  ev.decision.reason ||
                  '',
                finalDecision: ev.decision,
              }
            : t,
        ),
      );
      // Don't clobber an `error` status set by a prior `error` event —
      // `done` always follows `error` per the gateway contract.
      setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
      return;
    case 'error':
      setError(ev.message);
      setStatus('error');
      return;
    default:
      return;
  }
}

const ALLOWED_IMAGE_MEDIA: ReadonlyArray<JarvisAttachment['mediaType']> = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

function isAllowedMediaType(t: string): t is JarvisAttachment['mediaType'] {
  return (ALLOWED_IMAGE_MEDIA as ReadonlyArray<string>).includes(t);
}

async function fileToJarvisAttachment(file: File): Promise<JarvisAttachment> {
  if (!isAllowedMediaType(file.type)) {
    throw new Error(
      `unsupported image media type "${file.type || 'unknown'}" (allowed: ${ALLOWED_IMAGE_MEDIA.join(', ')})`,
    );
  }
  const dataUrl = await readFileAsDataUrl(file);
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return {
    kind: 'image',
    mediaType: file.type,
    data: base64,
    ...(file.name ? { caption: file.name } : {}),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('FileReader returned a non-string result'));
    };
    reader.onerror = (): void =>
      reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}
