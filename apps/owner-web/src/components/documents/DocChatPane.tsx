'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Send, Loader2 } from 'lucide-react';
import type { DocumentRecord } from '@/lib/types/documents';
import { askDocument, type DocChatAnswer } from '@/lib/queries/doc-chat';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { docChatStrings as S } from '@/i18n/strings/doc-chat';

const schema = z.object({
  question: z.string().min(2),
});
type FormValues = z.infer<typeof schema>;

interface DocChatPaneProps {
  readonly document: DocumentRecord;
  readonly onAnchor: (chunkId: string | null) => void;
}

interface DocMessage {
  readonly id: string;
  readonly role: 'owner' | 'doc-agent';
  readonly content: string;
  /** Real evidence chunk ids returned by the gateway (never fabricated). */
  readonly evidenceIds?: ReadonlyArray<string>;
  /** Set only when the gateway has not yet produced a written answer. */
  readonly pending?: boolean;
}

/**
 * Per-document chat. Wired to the LIVE document-intelligence pipeline
 * (open session → ask). Every answer is grounded in evidence chunks the
 * gateway draws ONLY from this document. We render the gateway's REAL
 * answer when present, otherwise an honest "evidence located, written
 * answer pending" state — we never synthesise a quote client-side.
 */
export function DocChatPane({ document, onAnchor }: DocChatPaneProps) {
  const locale = useLocale();
  const [messages, setMessages] = useState<ReadonlyArray<DocMessage>>([]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { question: '' },
  });

  const ask = useMutation({
    mutationFn: (question: string): Promise<DocChatAnswer> =>
      askDocument({ documentId: document.id, question, language: locale }),
    onSuccess: (result) => {
      setMessages((prev) => [
        ...prev,
        buildAgentMessage(document, result, locale),
      ]);
      // Anchor the PDF preview only when an evidence id maps to a known
      // local chunk; corpus chunk ids that don't match are listed, not
      // forced onto a wrong paragraph.
      const anchorable = result.evidenceIds.find((id) =>
        document.chunks.some((c) => c.id === id),
      );
      onAnchor(anchorable ?? null);
    },
  });

  const submit = (values: FormValues): void => {
    const owner: DocMessage = {
      id: `qm_${Date.now()}`,
      role: 'owner',
      content: values.question,
    };
    setMessages((prev) => [...prev, owner]);
    ask.mutate(values.question);
    reset({ question: '' });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 && !ask.isPending ? (
          <p className="text-muted-foreground">
            {pickByLocale(locale, S.intro(document.title))}
          </p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-md ${m.role === 'owner' ? '' : 'ml-auto text-right'}`}
          >
            <div className="text-tiny text-muted-foreground">
              {m.role === 'owner'
                ? pickByLocale(locale, S.roleOwner)
                : pickByLocale(locale, S.roleAgent)}
            </div>
            <div
              className={`mt-0.5 rounded-md px-2 py-1.5 text-sm ${
                m.role === 'owner'
                  ? 'bg-surface text-foreground'
                  : 'border border-warning/40 bg-warning-subtle/20 text-foreground'
              }`}
            >
              <p>{m.content}</p>
              {m.evidenceIds && m.evidenceIds.length > 0 ? (
                <div className="mt-1 flex flex-wrap justify-end gap-1">
                  {m.evidenceIds.map((eid) => (
                    <button
                      key={eid}
                      type="button"
                      onClick={() => onAnchor(eid)}
                      className="rounded-full border border-warning/40 px-2 py-0.5 font-mono text-tiny text-warning hover:underline"
                      title={pickByLocale(locale, S.evidenceTitle)}
                    >
                      {eid.slice(0, 8)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {ask.isPending ? (
          <div className="ml-auto flex max-w-md items-center justify-end gap-2 text-tiny text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />{' '}
            {pickByLocale(locale, S.searching)}
          </div>
        ) : null}
        {ask.isError ? (
          <div
            role="alert"
            className="ml-auto max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-right text-sm text-destructive"
          >
            {pickByLocale(
              locale,
              S.agentUnreachable(
                (ask.error as Error)?.message ??
                  pickByLocale(locale, S.unknownError),
              ),
            )}
          </div>
        ) : null}
      </div>
      <form
        onSubmit={(e) => void handleSubmit(submit)(e)}
        className="flex gap-2 border-t border-border px-3 py-2"
      >
        <input
          {...register('question')}
          disabled={ask.isPending}
          placeholder={pickByLocale(locale, S.inputPlaceholder)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-warning disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={ask.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-sm text-warning disabled:opacity-60"
        >
          <Send className="h-4 w-4" /> {pickByLocale(locale, S.ask)}
        </button>
      </form>
      {errors.question ? (
        <div className="px-3 pb-2 text-xs text-destructive">
          {pickByLocale(locale, S.validationMin)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Build the agent reply from the gateway's REAL response. Renders the
 * written answer when the orchestrator produced one; otherwise an honest
 * "evidence located, answer pending" message carrying the real evidence
 * chunk ids. Never fabricates a quote.
 */
function buildAgentMessage(
  doc: DocumentRecord,
  result: DocChatAnswer,
  locale: Locale,
): DocMessage {
  const base: DocMessage = {
    id: `am_${Date.now()}`,
    role: 'doc-agent',
    content: '',
    evidenceIds: result.evidenceIds,
  };
  if (result.answer && result.answer.trim().length > 0) {
    return { ...base, content: result.answer };
  }
  const count = result.evidenceIds.length;
  if (count > 0) {
    return {
      ...base,
      pending: true,
      content: pickByLocale(
        locale,
        count === 1 ? S.pendingOne(doc.title) : S.pendingMany(doc.title, count),
      ),
    };
  }
  return {
    ...base,
    content: pickByLocale(locale, S.noEvidence(doc.title)),
  };
}
