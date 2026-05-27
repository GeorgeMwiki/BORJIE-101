'use client';

import { useEffect, useState } from 'react';
import { askSession, createSession, summariseDocument } from './api';
import type { UploadedDocument } from './types';
import { ingestionStatusLabel, kindLabel } from './types';

interface ChatTurn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface DocumentExplorerProps {
  readonly document: UploadedDocument;
  readonly initialPrompt?: string;
}

/**
 * DocumentExplorer (owner-web).
 *
 * Two-pane layout: PDF preview (iframe — uses the browser's PDF viewer
 * when available) on the left, chat surface on the right. The chat is
 * bound to a single-document intelligence session opened lazily.
 *
 * "Documents as alive entities" — this is the canonical owner-side
 * explorer surface.
 */
export function DocumentExplorer({ document, initialPrompt }: DocumentExplorerProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ReadonlyArray<ChatTurn>>([]);
  const [draft, setDraft] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (document.ingestionStatus !== 'ready') {
      return;
    }
    let cancelled = false;
    summariseDocument({ documentId: document.id, language: 'sw' })
      .then((res) => {
        if (!cancelled) setSummary(res.summary);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [document.id, document.ingestionStatus]);

  async function ensureSession(): Promise<string> {
    if (sessionId) {
      return sessionId;
    }
    const { sessionId: newId } = await createSession({
      documentIds: [document.id],
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      title: `Soma: ${document.fileName}`,
    });
    setSessionId(newId);
    return newId;
  }

  async function handleSend(event?: React.FormEvent): Promise<void> {
    event?.preventDefault();
    const question = draft.trim();
    if (question.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const userTurn: ChatTurn = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: question,
    };
    setTurns((prev) => [...prev, userTurn]);
    setDraft('');
    try {
      const id = await ensureSession();
      const res = await askSession({ sessionId: id, question, language: 'sw' });
      const assistantText =
        res.answer ??
        `Nimepokea swali. Hati hii ina vipande ${res.evidenceIds.length}. Brain itajibu mara tu wakati wa kuchakatwa.`;
      const assistantTurn: ChatTurn = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: assistantText,
      };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Ask failed.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid h-[calc(100vh-12rem)] grid-cols-1 gap-4 lg:grid-cols-2">
      <aside className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40">
        <header className="border-b border-border px-4 py-3">
          <h2 className="truncate text-base font-semibold text-foreground">
            {document.fileName}
          </h2>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
              {kindLabel(document.kind)}
            </span>
            <span
              className={
                'rounded-full border px-2 py-0.5 text-xs text-foreground ' +
                (document.ingestionStatus === 'ready'
                  ? 'border-success bg-success/10'
                  : document.ingestionStatus === 'failed'
                    ? 'border-destructive bg-destructive/10'
                    : 'border-border bg-background')
              }
            >
              {ingestionStatusLabel(document.ingestionStatus)}
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-hidden bg-black/40 p-4">
          {document.mimeType === 'application/pdf' ? (
            <iframe
              src={document.fileUrl}
              className="h-full w-full rounded-md bg-white"
              title={`Preview of ${document.fileName}`}
            />
          ) : document.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={document.fileUrl}
              alt={document.fileName}
              className="h-full w-full rounded-md object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              Hakiki haipatikani. Pakua faili kuona kamili.
            </div>
          )}
        </div>
        {summary ? (
          <div className="border-t border-border bg-background/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Muhtasari
            </p>
            <p className="mt-1 line-clamp-6 text-sm text-foreground">{summary}</p>
          </div>
        ) : null}
      </aside>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface/40">
        <ol className="flex-1 space-y-2 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <li className="text-center text-sm text-neutral-400">
              Anza mazungumzo na hati hii. Niulize lolote.
            </li>
          ) : (
            turns.map((turn) => (
              <li
                key={turn.id}
                className={
                  'max-w-[85%] rounded-md p-3 text-sm ' +
                  (turn.role === 'user'
                    ? 'ml-auto bg-foreground text-background'
                    : 'mr-auto bg-background text-foreground')
                }
              >
                {turn.text}
              </li>
            ))
          )}
        </ol>
        {error ? (
          <div role="alert" className="m-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
        <form
          onSubmit={handleSend}
          className="flex items-end gap-2 border-t border-border bg-background/40 p-3"
        >
          <label htmlFor="document-question" className="sr-only">
            Andika swali kuhusu hati
          </label>
          <textarea
            id="document-question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Andika swali..."
            disabled={busy}
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-surface p-2 text-sm text-foreground placeholder:text-neutral-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            aria-label="Tuma swali"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
          >
            {busy ? '...' : 'Tuma'}
          </button>
        </form>
      </div>
    </section>
  );
}
