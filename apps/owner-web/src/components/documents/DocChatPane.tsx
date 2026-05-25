'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send } from 'lucide-react';
import type { DocumentRecord } from '@/lib/mocks/documents';

const schema = z.object({
  question: z.string().min(2, 'Type at least 2 chars.'),
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
  readonly citedChunkId?: string;
}

/**
 * Per-document chat. Refuses to answer outside the document corpus by
 * design — every reply selects a chunk and quotes it. Clicking the
 * citation anchors the PDF preview to that paragraph.
 */
export function DocChatPane({ document, onAnchor }: DocChatPaneProps) {
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

  const submit = (values: FormValues): void => {
    const owner: DocMessage = {
      id: `qm_${Date.now()}`,
      role: 'owner',
      content: values.question,
    };
    const cited = pickChunkForQuestion(document, values.question);
    const answer: DocMessage = {
      id: `am_${Date.now() + 1}`,
      role: 'doc-agent',
      content: cited
        ? `From ${document.title} (page ${cited.page}): ${cited.text}`
        : `I cannot find evidence in ${document.title} for that question. Try rephrasing or upload a related document.`,
      ...(cited ? { citedChunkId: cited.id } : {}),
    };
    setMessages((prev) => [...prev, owner, answer]);
    if (answer.citedChunkId) onAnchor(answer.citedChunkId);
    reset({ question: '' });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {messages.length === 0 ? (
          <p className="text-neutral-500">
            Ask a question about {document.title}. Every answer cites a
            bounding-box paragraph from this document.
          </p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-md ${m.role === 'owner' ? '' : 'ml-auto text-right'}`}
          >
            <div className="text-[10px] text-neutral-500">
              {m.role === 'owner' ? 'Owner' : 'Document agent'}
            </div>
            <div
              className={`mt-0.5 rounded-md px-2 py-1.5 text-sm ${
                m.role === 'owner'
                  ? 'bg-surface text-foreground'
                  : 'border border-warning/40 bg-warning-subtle/20 text-foreground'
              }`}
            >
              <p>{m.content}</p>
              {m.citedChunkId ? (
                <button
                  type="button"
                  onClick={() => onAnchor(m.citedChunkId ?? null)}
                  className="mt-1 text-[10px] text-warning hover:underline"
                >
                  jump to citation
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => void handleSubmit(submit)(e)}
        className="flex gap-2 border-t border-border px-3 py-2"
      >
        <input
          {...register('question')}
          placeholder="What does the licence say about annual rent?"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-sm text-warning"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>
      {errors.question ? (
        <div className="px-3 pb-2 text-xs text-destructive">
          {errors.question.message}
        </div>
      ) : null}
    </div>
  );
}

function pickChunkForQuestion(doc: DocumentRecord, question: string) {
  const q = question.toLowerCase();
  return (
    doc.chunks.find((c) =>
      q
        .split(/\W+/)
        .filter((w) => w.length > 3)
        .some((w) => c.text.toLowerCase().includes(w)),
    ) ?? doc.chunks[0]
  );
}
