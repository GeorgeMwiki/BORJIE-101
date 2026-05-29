/**
 * useGhostCompletion — Roadmap R9.
 *
 * Fetches `/api/v1/brain/compose/suggest` for the user's in-progress
 * input and returns a single-line completion. Designed to render as
 * dim ghost text in a composer — Tab accepts, any keystroke cancels.
 *
 * Debounces at 120 ms so we don't fire on every keystroke. Cancels
 * any in-flight fetch when the input changes. Returns `''` when no
 * suggestion is available — the caller should render nothing in that
 * case.
 */

import { useEffect, useRef, useState } from 'react';

const DEFAULT_DEBOUNCE_MS = 120;

export interface UseGhostCompletionOptions {
  readonly language?: 'sw' | 'en';
  readonly debounceMs?: number;
  /** Test seam — override the fetch implementation. */
  readonly fetcher?: typeof fetch;
}

export function useGhostCompletion(
  input: string,
  options: UseGhostCompletionOptions = {},
): string {
  const [completion, setCompletion] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setCompletion('');
      return;
    }
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const fetcher = options.fetcher ?? fetch;
        const res = await fetcher('/api/v1/brain/compose/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            text: input,
            language: options.language ?? 'sw',
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setCompletion('');
          return;
        }
        const json = (await res.json()) as {
          success: boolean;
          data?: { suggestion?: string };
        };
        setCompletion(json.data?.suggestion ?? '');
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.includes('aborted'))
        ) {
          // Expected — user kept typing.
          return;
        }
        setCompletion('');
      }
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [input, options.language, options.debounceMs, options.fetcher]);

  return completion;
}
