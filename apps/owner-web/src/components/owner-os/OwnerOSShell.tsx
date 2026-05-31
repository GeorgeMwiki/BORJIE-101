'use client';

/**
 * OwnerOSShell — the cockpit-home tab shell.
 *
 * Wave OWNER-OS + OWNER-OS-DYNAMIC. The cockpit home is a tab strip the
 * owner can spawn, pin, close, reorder, and rename. Every tab in the
 * strip is driven by the @borjie/owner-os-tabs registry; the renderer
 * map (apps/owner-web/src/components/owner-os/panels/index.ts) maps a
 * descriptor's `rendererId` to its React component.
 *
 * Tab kinds the brain can spawn (HR, Ops, Finance, Risk, Compliance,
 * Workforce, Procurement, Audit, Legal, ESG, Geology, Treasury,
 * Marketplace, Licences, Sites, Safety, Reports, Accounting) all flow
 * through the same path:
 *
 *   1. Brain emits `<spawn_tabs>{...}</spawn_tabs>` on a teaching turn,
 *      OR the owner clicks the "+" menu, OR the suggested-tab banner
 *      surfaces a deterministic intent match.
 *   2. The shell calls `spawnOrAugment(...)` on the tabs store with a
 *      deterministic id — re-spawning the same context augments rather
 *      than duplicates.
 *   3. The renderer map maps descriptor.rendererId → component; the
 *      component receives `{tabId, context, locale}` and renders.
 *
 * Keyboard shortcuts:
 *   - Cmd+T          open the spawn-tab modal
 *   - Cmd+W          close the active tab (unless pinned)
 *   - Cmd+1..9       jump to tab N in the strip
 *   - Cmd+Shift+T    re-open the most recently closed tab
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { X, Plus, History, Sparkles, AlertCircle, Check } from 'lucide-react';
import { useViewportBreakpoint } from '@borjie/dynamic-sections';
import {
  buildTabId,
  getTab,
  type OwnerOSSpawnIntent,
  type OwnerOSTabContext,
  type OwnerOSTabDescriptor,
  type OwnerOSTabType,
} from '@borjie/owner-os-tabs';

import { HomeChatTeach } from '@/components/home-chat/HomeChatTeach';
import {
  useOwnerTabs,
  type OwnerTab,
  type OwnerTabKind,
} from '@/lib/owner-tabs-store';
import {
  handleTabSseFrame,
  spawnPayloadToTab,
  type TabProposalPayload,
  type TabTagErrorPayload,
} from '@/lib/tab-sse-parser';

import { OwnerOSChatPanel } from './OwnerOSChatPanel';
import { useAdaptiveTabOrder } from './useAdaptiveTabOrder';
import { OwnerOSDocsPanel } from './OwnerOSDocsPanel';
import { OwnerOSRemindersPanel } from './OwnerOSRemindersPanel';
import { OwnerOSDraftsPanel } from './OwnerOSDraftsPanel';
import { OwnerOSInsightsPanel } from './OwnerOSInsightsPanel';
import { SpawnTabMenu } from './SpawnTabMenu';
import { PANEL_RENDERERS } from './panels';
// Registering built-in descriptors with the singleton registry happens
// as a top-level side-effect of importing this module.
import './panels/builtin-descriptors';
import { resolveIcon } from './panels/icon-map';
import { OwnerOSTabHost } from './OwnerOSTabHost';

const RECENT_CLOSED_MAX = 6;

export interface OwnerOSShellProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
  /**
   * Session identity threaded from the dashboard server component. Feeds
   * the adaptive-layout engine (UI-1) so the tab strip re-ranks the
   * owner's spawned tabs by real focus-recency. Optional with safe
   * defaults so the fallback mount + tests stay zero-config.
   */
  readonly tenantId?: string;
  readonly userId?: string;
  readonly role?: string;
}

interface RecentClosed {
  readonly tab: OwnerTab;
  readonly closedAt: string;
}

export function OwnerOSShell({
  salutation,
  tradingName,
  languagePreference,
  tenantId = 'owner-web',
  userId = 'owner',
  role = 'owner',
}: OwnerOSShellProps): ReactElement {
  const {
    tabs,
    activeTabId,
    activeTab,
    open,
    spawnOrAugment,
    close,
    focus,
    rename,
    patchState,
  } = useOwnerTabs();

  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const [recentClosed, setRecentClosed] = useState<ReadonlyArray<RecentClosed>>(
    [],
  );

  // Wave SUPERPOWERS (CT-3): brain-emitted tab proposals + tag errors.
  // The chat stream forwards these via `onProposal` / `onError`; we hold
  // them here and surface accept/dismiss chips in the strip tray below.
  const [proposals, setProposals] = useState<ReadonlyArray<TabProposalPayload>>(
    [],
  );
  const [tabErrors, setTabErrors] = useState<
    ReadonlyArray<{ readonly key: string; readonly payload: TabTagErrorPayload }>
  >([]);
  const errorKeyRef = useRef(0);

  const closedTabsRef = useRef<ReadonlyArray<OwnerTab>>([]);
  closedTabsRef.current = tabs;

  // Wave SUPERPOWERS (UI-1): adaptive tab ordering. Track focus-recency
  // (most-recent-first) and feed the engine so the owner's spawned tabs
  // re-rank by real usage. Pinned chrome (chat/docs/…) always stays first.
  const viewport = useViewportBreakpoint();
  const [recentTabIds, setRecentTabIds] = useState<ReadonlyArray<string>>([]);
  useEffect(() => {
    if (!activeTabId) return;
    setRecentTabIds((prev) =>
      prev[0] === activeTabId
        ? prev
        : [activeTabId, ...prev.filter((id) => id !== activeTabId)].slice(0, 10),
    );
  }, [activeTabId]);

  const { tabs: orderedTabs } = useAdaptiveTabOrder({
    tabs,
    tenantId,
    userId,
    role,
    recentActions: recentTabIds,
    viewport,
  });

  // ──────────────────────────────────────────────────────────────────
  // Spawning — used by the "+" menu, the suggested-tab banner, and the
  // future brain payload listener.
  // ──────────────────────────────────────────────────────────────────

  const spawnFromDescriptor = useCallback(
    (descriptor: OwnerOSTabDescriptor, context: OwnerOSTabContext = {}) => {
      const tabId = buildTabId(descriptor, context);
      const title =
        languagePreference === 'sw' ? descriptor.labelSw : descriptor.labelEn;
      const input: {
        kind: OwnerTabKind;
        title: string;
        context?: Readonly<Record<string, unknown>>;
      } = {
        kind: descriptor.type as OwnerTabKind,
        title,
      };
      if (Object.keys(context).length > 0) {
        input.context = context as Readonly<Record<string, unknown>>;
      }
      const result = spawnOrAugment(input);
      // Re-spawn already focuses on new spawn; force focus on dedup too so
      // owners see the augmented surface immediately when they pick from
      // the "+" menu.
      if (!result.isNew) focus(result.tabId);
      void tabId;
    },
    [languagePreference, spawnOrAugment, focus],
  );

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

  /**
   * Brain payload bridge — invoked from the chat bubble when the owner
   * clicks a `<spawn_tabs>` chip the brain emitted. The intent already
   * has `type` + `context` + `reason`; we route through the registry so
   * dedup + augment + idempotency apply.
   */
  const onSpawnTabFromBrain = useCallback(
    (intent: OwnerOSSpawnIntent) => {
      const descriptor = getTab(intent.type);
      if (!descriptor) return;
      spawnFromDescriptor(descriptor, intent.context);
    },
    [spawnFromDescriptor],
  );

  /**
   * Live brain → tab bridge (CT-3 / "tab_spawn sever"). HomeChatTeach
   * forwards every recognised tab SSE frame UP to this single store
   * instance. `handleTabSseFrame` parses the envelope and dispatches to
   * the matching handler below; the handlers mirror the `<spawn_tabs>`
   * chip path (spawnOrAugment) so dedup + augment + idempotency apply.
   */
  const handleBrainTabFrame = useCallback(
    (eventName: string, rawData: string) =>
      handleTabSseFrame({
        eventName,
        rawData,
        handlers: {
          onSpawn: (p) => {
            const tab = spawnPayloadToTab(p, languagePreference);
            if (!tab) return;
            const input: {
              kind: OwnerTabKind;
              title: string;
              context?: Readonly<Record<string, unknown>>;
            } = {
              kind: tab.kind,
              title: tab.title,
            };
            if (tab.context && Object.keys(tab.context).length > 0) {
              input.context = tab.context;
            }
            spawnOrAugment(input);
          },
          onUpdate: (p) => {
            if (p.patch.config) patchState(p.tabId, p.patch.config);
            const title =
              (languagePreference === 'sw' && p.titleSw) ||
              (languagePreference === 'en' && p.titleEn) ||
              p.patch.title;
            if (title) rename(p.tabId, title);
          },
          onRemove: (p) => {
            close(p.tabId);
          },
          onProposal: (p) => {
            // Brain is unsure — render an accept/dismiss chip rather than
            // spawning silently. Dedupe by proposalId; cap the tray.
            setProposals((prev) =>
              prev.some((x) => x.proposalId === p.proposalId)
                ? prev
                : [...prev, p].slice(-4),
            );
          },
          onError: (p) => {
            // A tab tag didn't apply (unknown type / validation). Surface
            // a polite, dismissible "that doesn't apply" chip.
            errorKeyRef.current += 1;
            const key = `tab-err-${errorKeyRef.current}`;
            setTabErrors((prev) => [...prev, { key, payload: p }].slice(-4));
          },
        },
      }),
    [languagePreference, spawnOrAugment, patchState, rename, close],
  );

  // Accept a brain proposal → route through the same registry path as a
  // `<spawn_tabs>` chip so dedup + augment + idempotency apply, then drop
  // the chip. Unknown tab types are silently dropped (chip removed).
  const acceptProposal = useCallback(
    (proposal: TabProposalPayload) => {
      const descriptor = getTab(proposal.tabType as OwnerOSTabType);
      if (descriptor) {
        spawnFromDescriptor(
          descriptor,
          (proposal.config as OwnerOSTabContext) ?? {},
        );
      }
      setProposals((prev) =>
        prev.filter((p) => p.proposalId !== proposal.proposalId),
      );
    },
    [spawnFromDescriptor],
  );

  const dismissProposal = useCallback((proposalId: string) => {
    setProposals((prev) => prev.filter((p) => p.proposalId !== proposalId));
  }, []);

  const dismissTabError = useCallback((key: string) => {
    setTabErrors((prev) => prev.filter((e) => e.key !== key));
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Closing — also record recent-closed for Cmd+Shift+T reopen.
  // ──────────────────────────────────────────────────────────────────

  const closeAndRemember = useCallback(
    (tabId: string) => {
      const tab = closedTabsRef.current.find((t) => t.id === tabId);
      if (tab && !tab.pinned) {
        setRecentClosed((prev) =>
          [{ tab, closedAt: new Date().toISOString() }, ...prev].slice(
            0,
            RECENT_CLOSED_MAX,
          ),
        );
      }
      close(tabId);
    },
    [close],
  );

  const reopenRecent = useCallback(
    (entry: RecentClosed) => {
      // Re-spawn via the registry path so dedup + augment apply.
      const descriptor = getTab(entry.tab.kind as OwnerOSTabType);
      if (descriptor) {
        spawnFromDescriptor(
          descriptor,
          (entry.tab.context as OwnerOSTabContext) ?? {},
        );
      } else {
        // Fallback for ad-hoc tabs (e.g. doc-context) without a registry
        // descriptor — re-open directly.
        open(entry.tab);
      }
      setRecentClosed((prev) => prev.filter((r) => r !== entry));
    },
    [spawnFromDescriptor, open],
  );

  // ──────────────────────────────────────────────────────────────────
  // Keyboard shortcuts.
  // ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      // Cmd+T → spawn menu
      if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault();
        setSpawnMenuOpen(true);
        return;
      }
      // Cmd+Shift+T → reopen last closed
      if (e.key.toLowerCase() === 't' && e.shiftKey) {
        e.preventDefault();
        const last = recentClosed[0];
        if (last) reopenRecent(last);
        return;
      }
      // Cmd+W → close active
      if (e.key.toLowerCase() === 'w') {
        if (activeTabId) {
          e.preventDefault();
          closeAndRemember(activeTabId);
        }
        return;
      }
      // Cmd+1..9 → focus tab N (in the visible, adaptively-ordered strip)
      const n = Number.parseInt(e.key, 10);
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        const target = orderedTabs[n - 1];
        if (target) {
          e.preventDefault();
          focus(target.id);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeTabId,
    closeAndRemember,
    focus,
    recentClosed,
    reopenRecent,
    orderedTabs,
  ]);

  // ──────────────────────────────────────────────────────────────────
  // Active panel renderer.
  // ──────────────────────────────────────────────────────────────────

  const renderActivePanel = useCallback(
    (tab: OwnerTab | null): ReactNode => {
      if (!tab) return null;
      // Built-ins keep their bespoke prop shapes.
      switch (tab.kind) {
        case 'chat':
          return (
            <OwnerOSChatPanel
              salutation={salutation}
              tradingName={tradingName}
              languagePreference={languagePreference}
              onSpawnDocTab={onSpawnDocTab}
              onSpawnTab={onSpawnTabFromBrain}
              onTabSseFrame={handleBrainTabFrame}
            />
          );
        case 'docs':
          return (
            <OwnerOSDocsPanel
              languagePreference={languagePreference}
              onOpenDoc={onSpawnDocTab}
            />
          );
        case 'drafts':
          return (
            <OwnerOSDraftsPanel languagePreference={languagePreference} />
          );
        case 'reminders':
          return (
            <OwnerOSRemindersPanel languagePreference={languagePreference} />
          );
        case 'insights':
          return (
            <OwnerOSInsightsPanel languagePreference={languagePreference} />
          );
        case 'doc-context': {
          const documentId =
            typeof tab.context?.documentId === 'string'
              ? (tab.context.documentId as string)
              : undefined;
          return (
            <OwnerOSDocsPanel
              languagePreference={languagePreference}
              {...(documentId !== undefined && {
                initialFocusDocumentId: documentId,
              })}
              onOpenDoc={onSpawnDocTab}
            />
          );
        }
        default: {
          const descriptor = getTab(tab.kind as OwnerOSTabType);
          if (!descriptor) return null;
          const Component = PANEL_RENDERERS[descriptor.rendererId];
          if (!Component) return null;
          const context = (tab.context as OwnerOSTabContext | undefined) ?? {};
          return (
            <Component
              tabId={tab.id}
              context={context}
              locale={languagePreference}
            />
          );
        }
      }
    },
    [
      handleBrainTabFrame,
      languagePreference,
      onSpawnDocTab,
      onSpawnTabFromBrain,
      salutation,
      tradingName,
    ],
  );

  // ──────────────────────────────────────────────────────────────────
  // Tab strip indicator dot.
  // ──────────────────────────────────────────────────────────────────

  const dotFor = useCallback((tab: OwnerTab): string | null => {
    if ((tab.pendingUpdates ?? 0) > 0) return 'bg-warning';
    if (tab.pinned && (tab.kind === 'compliance' || tab.kind === 'risk')) {
      return 'bg-success';
    }
    return null;
  }, []);

  const stripIcon = useCallback((kind: OwnerTabKind) => {
    const d = getTab(kind as OwnerOSTabType);
    return d ? resolveIcon(d.iconName) : null;
  }, []);

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────

  const hasRecent = recentClosed.length > 0;

  return (
    <div className="flex flex-col gap-4" data-testid="owner-os-shell">
      <nav
        aria-label="Owner cockpit tabs"
        className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-surface/50 px-3 py-2"
        data-testid="owner-os-tab-strip"
      >
        {orderedTabs.map((t) => {
          const Icon = stripIcon(t.kind);
          const dot = dotFor(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => focus(t.id)}
              data-testid={`owner-os-tab-${t.id}`}
              data-active={t.id === activeTabId || undefined}
              className={`group flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                t.id === activeTabId
                  ? 'border-warning bg-warning/10 text-warning'
                  : 'border-border bg-surface text-neutral-300 hover:border-warning/40 hover:text-foreground'
              }`}
            >
              {Icon ? (
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              ) : null}
              <span>{t.title}</span>
              {dot ? (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${dot}`}
                />
              ) : null}
              {(t.pendingUpdates ?? 0) > 0 ? (
                <span
                  aria-label={`${t.pendingUpdates} pending updates`}
                  className="rounded-full bg-warning/30 px-1.5 text-tiny font-semibold text-warning"
                >
                  +{t.pendingUpdates}
                </span>
              ) : null}
              {t.pinned ? null : (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAndRemember(t.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      closeAndRemember(t.id);
                    }
                  }}
                  className="rounded p-0.5 text-neutral-500 hover:bg-destructive/20 hover:text-destructive"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSpawnMenuOpen(true)}
          aria-label={
            languagePreference === 'sw' ? 'Fungua tab mpya' : 'Spawn a new tab'
          }
          data-testid="owner-os-spawn-button"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-warning/40 bg-warning/5 px-2 py-1 text-tiny font-semibold text-warning hover:bg-warning/10"
        >
          <Plus aria-hidden="true" className="h-3 w-3" />
          {languagePreference === 'sw' ? 'Tab mpya' : 'New tab'}
          <kbd className="rounded border border-warning/30 px-1 font-mono text-tiny">
            ⌘T
          </kbd>
        </button>
      </nav>

      {hasRecent ? (
        <div
          aria-label={
            languagePreference === 'sw'
              ? 'Tabs zilizofungwa hivi karibuni'
              : 'Recent tabs'
          }
          data-testid="owner-os-recent-tray"
          className="flex flex-wrap items-center gap-2 px-3 text-tiny text-neutral-500"
        >
          <History aria-hidden="true" className="h-3 w-3" />
          <span>
            {languagePreference === 'sw'
              ? 'Zilizofungwa hivi karibuni'
              : 'Recently closed'}
          </span>
          {recentClosed.map((entry) => (
            <button
              key={`${entry.tab.id}_${entry.closedAt}`}
              type="button"
              onClick={() => reopenRecent(entry)}
              className="rounded border border-border bg-surface/40 px-2 py-0.5 text-neutral-300 hover:border-warning/40 hover:text-foreground"
              data-testid={`owner-os-recent-${entry.tab.id}`}
            >
              {entry.tab.title}
            </button>
          ))}
        </div>
      ) : null}

      {proposals.length > 0 || tabErrors.length > 0 ? (
        <div
          data-testid="owner-os-proposal-tray"
          className="flex flex-col gap-2 px-3"
        >
          {proposals.map((p) => {
            const reason =
              languagePreference === 'sw' && p.reasonSw
                ? p.reasonSw
                : p.reasonEn;
            const title =
              (languagePreference === 'sw' && p.titleSw) ||
              (languagePreference === 'en' && p.titleEn) ||
              p.title;
            return (
              <div
                key={p.proposalId}
                data-testid={`owner-os-proposal-${p.proposalId}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2"
              >
                <Sparkles
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-warning"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-semibold text-warning">
                    {title}
                  </span>
                  <span className="truncate text-tiny text-neutral-400">
                    {reason}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => acceptProposal(p)}
                  data-testid={`owner-os-proposal-accept-${p.proposalId}`}
                  className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-tiny font-semibold text-success hover:bg-success/20"
                >
                  <Check aria-hidden="true" className="h-3 w-3" />
                  {languagePreference === 'sw' ? 'Kubali' : 'Open'}
                </button>
                <button
                  type="button"
                  onClick={() => dismissProposal(p.proposalId)}
                  aria-label={
                    languagePreference === 'sw'
                      ? 'Ondoa pendekezo'
                      : 'Dismiss proposal'
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1 text-tiny text-neutral-400 hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {tabErrors.map(({ key, payload }) => {
            const reason =
              languagePreference === 'sw' ? payload.reasonSw : payload.reasonEn;
            return (
              <div
                key={key}
                data-testid="owner-os-tab-error"
                className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2"
              >
                <AlertCircle
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-destructive"
                />
                <span className="min-w-0 flex-1 truncate text-tiny text-neutral-300">
                  {reason}
                </span>
                <button
                  type="button"
                  onClick={() => dismissTabError(key)}
                  aria-label={languagePreference === 'sw' ? 'Ondoa' : 'Dismiss'}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-tiny text-neutral-400 hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/*
        OwnerOSTabHost wraps EVERY tab in a <TabSleeper>. Only the active
        tab has its panel mounted; the rest render a snapshot placeholder
        and run no effects (websockets / timers cleaned up). Backend brain
        awareness is unaffected — the teaching prompt extension keeps the
        full tab list in the model's context every turn.
      */}
      <OwnerOSTabHost
        tabs={tabs}
        activeTabId={activeTabId}
        languagePreference={languagePreference}
        renderPanel={(tab) => renderActivePanel(tab)}
      />

      {/* Fallback — render the regular HomeChatTeach so the home is never
          blank if every tab is somehow closed. */}
      {tabs.length === 0 ? (
        <HomeChatTeach
          salutation={salutation}
          tradingName={tradingName}
          languagePreference={languagePreference}
        />
      ) : null}

      <SpawnTabMenu
        languagePreference={languagePreference}
        open={spawnMenuOpen}
        onClose={() => setSpawnMenuOpen(false)}
        onSpawn={(d) => {
          setSpawnMenuOpen(false);
          spawnFromDescriptor(d);
        }}
        onAskBrain={(prompt) => {
          // Hand the free-form ask to the brain via the chat panel. The
          // simplest path: focus the Chat tab + drop the prompt into the
          // chat draft via a sessionStorage hand-off the chat picks up
          // on next render. The brain replies with <spawn_tabs> and the
          // FE renders the suggestion chip beneath its bubble.
          try {
            sessionStorage.setItem('borjie:home-chat:queued-prompt', prompt);
          } catch {
            /* private mode — drop silently */
          }
          // Focus chat so the queued prompt is visible immediately.
          const chat = tabs.find((t) => t.kind === 'chat');
          if (chat) focus(chat.id);
        }}
      />
    </div>
  );
}
