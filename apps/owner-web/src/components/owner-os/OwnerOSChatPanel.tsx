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
import { Upload } from 'lucide-react';
import type { OwnerOSSpawnIntent } from '@borjie/owner-os-tabs';
import { HomeChatTeach } from '@/components/home-chat/HomeChatTeach';
import { Blackboard } from '@/components/blackboard';
import { apiRequest } from '@/lib/api-client';
import { ownerOsAStrings as S } from '@/i18n/strings/owner-os-a';

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
  /**
   * Called for every recognised tab SSE frame the brain-teach stream
   * emits (tab_spawn / tab_update / tab_remove / tab_proposal /
   * tab_tag_error). Forwarded UP to OwnerOSShell so the single
   * `useOwnerTabs()` store instance applies the action live.
   */
  readonly onTabSseFrame?: (eventName: string, rawData: string) => void;
}

export function OwnerOSChatPanel({
  salutation,
  tradingName,
  languagePreference,
  onSpawnDocTab,
  onSpawnTab,
  onTabSseFrame,
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
        setStatus({
          kind: 'error',
          message:
            languagePreference === 'sw'
              ? S.chatPanel.noSupported.sw
              : S.chatPanel.noSupported.en,
        });
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
            message:
              e instanceof Error
                ? e.message
                : languagePreference === 'sw'
                  ? S.chatPanel.intakeFailed.sw
                  : S.chatPanel.intakeFailed.en,
          });
          return;
        }
        done += 1;
        setStatus({ kind: 'uploading', total: accepted.length, done });
      }
      setStatus({ kind: 'done', results });
    },
    [onSpawnDocTab, languagePreference],
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

  const onAttachFiles = useCallback(
    (files: ReadonlyArray<File>) => {
      void handleFiles(files);
    },
    [handleFiles],
  );

  const filingStatus =
    status.kind === 'uploading'
      ? languagePreference === 'sw'
        ? `Inapakia ${status.done}/${status.total}…`
        : `Filing ${status.done}/${status.total}…`
      : status.kind === 'done'
        ? languagePreference === 'sw'
          ? `${S.chatPanel.filedDonePrefix.sw}${status.results.length}${S.chatPanel.filedDoneSuffix.sw}`
          : `${S.chatPanel.filedDonePrefix.en}${status.results.length} document${status.results.length === 1 ? '' : 's'}`
        : status.kind === 'error'
          ? status.message
          : null;

  // The whole panel IS the drop target now. The dashed banner is gone — its
  // ~90px is recovered for the transcript. An absolute, pointer-events-none
  // overlay appears ONLY while dragging over the panel; the paperclip in the
  // composer is the always-available attach path.
  return (
    <div
      className="relative flex flex-col gap-3"
      data-testid="owner-os-chat-panel"
      onDragEnter={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        // Only clear when the drag actually leaves the panel (not a child).
        if (e.currentTarget === e.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      {/* Compact, ephemeral filing status — only when something is happening. */}
      {filingStatus ? (
        <p
          data-testid="owner-os-filing-status"
          className={`text-tiny ${
            status.kind === 'error'
              ? 'text-destructive'
              : status.kind === 'done'
                ? 'text-success'
                : 'text-warning'
          }`}
          role="status"
          aria-live="polite"
        >
          {filingStatus}
        </p>
      ) : null}

      {/* Drag-only overlay — shown while a file is dragged over the panel. */}
      {dropActive ? (
        <div
          data-testid="owner-os-drop-overlay"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-warning bg-background/80 backdrop-blur-sm"
        >
          <Upload className="h-6 w-6 text-warning" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {languagePreference === 'sw'
              ? S.chatPanel.dropOverlay.sw
              : S.chatPanel.dropOverlay.en}
          </p>
          <p className="text-tiny text-neutral-400">
            PDF · DOCX · XLSX · JPG · PNG · TXT (≤25 MB)
          </p>
        </div>
      ) : null}

      <div
        className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,_55fr)_minmax(0,_45fr)]"
        data-testid="owner-os-chat-board-split"
      >
        <HomeChatTeach
          salutation={salutation}
          tradingName={tradingName}
          languagePreference={languagePreference}
          onAttachFiles={onAttachFiles}
          attachLabel={
            languagePreference === 'sw'
              ? S.chatPanel.attach.sw
              : S.chatPanel.attach.en
          }
          {...(onSpawnTab ? { onSpawnTab } : {})}
          {...(onTabSseFrame ? { onTabSseFrame } : {})}
        />
        <Blackboard
          languagePreference={languagePreference}
          tradingName={tradingName}
        />
      </div>
    </div>
  );
}
