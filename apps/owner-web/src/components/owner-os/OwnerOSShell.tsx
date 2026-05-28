'use client';

/**
 * OwnerOSShell — the cockpit-home tab shell.
 *
 * Wave OWNER-OS. Renders a tab strip across the top (Chat / Docs /
 * Drafts / Reminders / Insights + spawnable tabs) and a panel for the
 * active tab below. Tab state lives in `useOwnerTabs` (localStorage +
 * server sync), so closing + reopening preserves everything.
 *
 * The Chat panel is the existing HomeChatTeach + an upload drop-zone
 * that intakes documents via `POST /api/v1/owner/docs/intake`. The
 * Docs / Drafts / Reminders / Insights panels are lazy-loaded so the
 * initial Chat-first render stays light.
 *
 * No mock data. Every panel hits the live api-gateway.
 */

import { useCallback, type ReactElement } from 'react';
import { X, Plus } from 'lucide-react';
import { HomeChatTeach } from '@/components/home-chat/HomeChatTeach';
import { useOwnerTabs, type OwnerTab } from '@/lib/owner-tabs-store';
import { OwnerOSChatPanel } from './OwnerOSChatPanel';
import { OwnerOSDocsPanel } from './OwnerOSDocsPanel';
import { OwnerOSRemindersPanel } from './OwnerOSRemindersPanel';
import { OwnerOSDraftsPanel } from './OwnerOSDraftsPanel';
import { OwnerOSInsightsPanel } from './OwnerOSInsightsPanel';

export interface OwnerOSShellProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
}

export function OwnerOSShell({
  salutation,
  tradingName,
  languagePreference,
}: OwnerOSShellProps): ReactElement {
  const { tabs, activeTabId, activeTab, open, close, focus } = useOwnerTabs();

  const onSpawnDocTab = useCallback(
    (documentId: string, label: string) => {
      const tab: OwnerTab = {
        id: `doc:${documentId}`,
        kind: 'doc-context',
        title: label.length > 28 ? `${label.slice(0, 25)}…` : label,
        context: { documentId },
      };
      open(tab);
    },
    [open],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="owner-os-shell">
      <nav
        aria-label="Owner cockpit tabs"
        className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface/50 px-3 py-2"
        data-testid="owner-os-tab-strip"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => focus(t.id)}
            data-testid={`owner-os-tab-${t.id}`}
            className={`group flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
              t.id === activeTabId
                ? 'border-warning bg-warning/10 text-warning'
                : 'border-border bg-surface text-neutral-300 hover:border-warning/40 hover:text-foreground'
            }`}
          >
            <span>{t.title}</span>
            {t.pinned ? null : (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    close(t.id);
                  }
                }}
                className="rounded p-0.5 text-neutral-500 hover:bg-destructive/20 hover:text-destructive"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-tiny text-neutral-500">
          <Plus aria-hidden="true" className="h-3 w-3" />
          {languagePreference === 'sw'
            ? 'Bonyeza hati ili kufungua tab'
            : 'Tap a document to spawn a tab'}
        </span>
      </nav>

      <section
        aria-label="Active tab panel"
        data-testid={`owner-os-panel-${activeTabId ?? 'chat'}`}
      >
        {activeTab?.kind === 'chat' || activeTab === null ? (
          <OwnerOSChatPanel
            salutation={salutation}
            tradingName={tradingName}
            languagePreference={languagePreference}
            onSpawnDocTab={onSpawnDocTab}
          />
        ) : null}
        {activeTab?.kind === 'docs' ? (
          <OwnerOSDocsPanel
            languagePreference={languagePreference}
            onOpenDoc={onSpawnDocTab}
          />
        ) : null}
        {activeTab?.kind === 'drafts' ? (
          <OwnerOSDraftsPanel languagePreference={languagePreference} />
        ) : null}
        {activeTab?.kind === 'reminders' ? (
          <OwnerOSRemindersPanel languagePreference={languagePreference} />
        ) : null}
        {activeTab?.kind === 'insights' ? (
          <OwnerOSInsightsPanel languagePreference={languagePreference} />
        ) : null}
        {activeTab?.kind === 'doc-context' &&
        typeof activeTab.context?.documentId === 'string' ? (
          <OwnerOSDocsPanel
            languagePreference={languagePreference}
            initialFocusDocumentId={activeTab.context.documentId as string}
            onOpenDoc={onSpawnDocTab}
          />
        ) : null}
      </section>

      {/* Fallback — render the regular HomeChatTeach so the home is never
          blank if every tab is somehow closed (defence in depth). */}
      {tabs.length === 0 ? (
        <HomeChatTeach
          salutation={salutation}
          tradingName={tradingName}
          languagePreference={languagePreference}
        />
      ) : null}
    </div>
  );
}
