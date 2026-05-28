'use client';

/**
 * OwnerOSChatPanel — chat surface with file drop-zone.
 *
 * Wave OWNER-OS. Wraps HomeChatTeach (the streaming /brain/teach
 * surface) with a top-edge drop-zone. When the owner drops one or many
 * files we POST each one to `/api/v1/owner/docs/intake` and stream a
 * micro-status banner ("Filed 3 documents · 2 categorised as licence
 * …"). The newly-filed doc ids are also fed back to the parent so the
 * Docs tab can pre-focus the first one.
 */

import { useCallback, useState, type DragEvent, type ReactElement } from 'react';
import { Upload, CheckCircle, AlertTriangle } from 'lucide-react';
import type { OwnerOSSpawnIntent } from '@borjie/owner-os-tabs';
import { HomeChatTeach } from '@/components/home-chat/HomeChatTeach';
import { Blackboard } from '@/components/blackboard';
import { apiRequest } from '@/lib/api-client';

const ACCEPT_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
];

interface IntakeResult {
  readonly documentId: string;
  readonly category: string;
  readonly presignedPut: string;
}

export interface OwnerOSChatPanelProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
  readonly onSpawnDocTab: (documentId: string, label: string) => void;
  /** Called when the brain emits a <spawn_tabs> chip the owner clicks. */
  readonly onSpawnTab?: (intent: OwnerOSSpawnIntent) => void;
}

export function OwnerOSChatPanel({
  salutation,
  tradingName,
  languagePreference,
  onSpawnDocTab,
  onSpawnTab,
}: OwnerOSChatPanelProps): ReactElement {
  const [dropActive, setDropActive] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading'; total: number; done: number }
    | { kind: 'done'; results: ReadonlyArray<IntakeResult & { fileName: string }> }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const handleFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      const accepted = files.filter((f) => ACCEPT_MIMES.includes(f.type) || f.name.match(/\.(pdf|docx|xlsx|jpg|png|txt)$/i));
      if (accepted.length === 0) {
        setStatus({ kind: 'error', message: 'No supported files in drop' });
        return;
      }
      setStatus({ kind: 'uploading', total: accepted.length, done: 0 });
      const results: Array<IntakeResult & { fileName: string }> = [];
      let done = 0;
      for (const file of accepted) {
        try {
          const reg = await apiRequest<IntakeResult>(`/api/v1/owner/docs/intake`, {
            method: 'POST',
            body: {
              fileName: file.name,
              fileSize: file.size,
              mimeType: file.type || 'application/octet-stream',
            },
          });
          results.push({ ...reg, fileName: file.name });
          // Spawn a doc-context tab for the first uploaded file so the
          // owner is dropped into the conversation immediately.
          if (results.length === 1) {
            onSpawnDocTab(reg.documentId, file.name);
          }
        } catch (e) {
          setStatus({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Intake failed',
          });
          return;
        }
        done += 1;
        setStatus({ kind: 'uploading', total: accepted.length, done });
      }
      setStatus({ kind: 'done', results });
    },
    [onSpawnDocTab],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDropActive(false);
      const files = Array.from(e.dataTransfer.files);
      void handleFiles(files);
    },
    [handleFiles],
  );

  return (
    <div className="flex flex-col gap-3" data-testid="owner-os-chat-panel">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
        data-testid="owner-os-drop-zone"
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-4 text-center transition ${
          dropActive
            ? 'border-warning bg-warning/10'
            : 'border-border bg-surface/30 text-neutral-400'
        }`}
      >
        <Upload aria-hidden="true" className="h-5 w-5 text-warning" />
        <p className="text-sm">
          {languagePreference === 'sw'
            ? 'Vuta hati hapa — Mr. Mwikila atazisoma, kuziainisha, na kuzifungua kwa mazungumzo'
            : 'Drop documents here — Mr. Mwikila reads, files, and opens them for conversation'}
        </p>
        <p className="text-tiny text-neutral-500">PDF · DOCX · XLSX · JPG · PNG · TXT (≤25 MB)</p>
        {status.kind === 'uploading' ? (
          <p className="text-tiny text-warning">
            {languagePreference === 'sw'
              ? `Inapakia ${status.done}/${status.total}…`
              : `Filing ${status.done}/${status.total}…`}
          </p>
        ) : null}
        {status.kind === 'done' ? (
          <p className="inline-flex items-center gap-1 text-tiny text-success">
            <CheckCircle aria-hidden="true" className="h-3.5 w-3.5" />
            {languagePreference === 'sw'
              ? `Hati ${status.results.length} zimewasilishwa`
              : `Filed ${status.results.length} document${status.results.length === 1 ? '' : 's'}`}
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="inline-flex items-center gap-1 text-tiny text-destructive">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            {status.message}
          </p>
        ) : null}
      </div>

      <HomeChatTeach
        salutation={salutation}
        tradingName={tradingName}
        languagePreference={languagePreference}
        {...(onSpawnTab ? { onSpawnTab } : {})}
      />
    </div>
  );
}
