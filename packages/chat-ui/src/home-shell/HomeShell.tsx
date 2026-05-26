'use client';
/**
 * HomeShell — the full-screen Home tab for every Borjie portal + app.
 *
 * The Home tab is the default route ("/") across all surfaces. It
 * renders a full-screen conversation with the persona resolved by
 * `resolveAudience` (which mirrors the role-routing table in §3 of
 * HOME_DASHBOARD_STANDARD.md).
 *
 * Composition:
 *   - HistoryRail (left)                — when variant = 'split_with_history'
 *   - PersonaHeader (top-right)
 *   - HomeProactiveBanner (top-center)  — when enable_proactive_banners
 *   - HomeMessageList (centre, scrolls)
 *   - HomeComposer (bottom, sticky)
 *
 * This component does NOT own message I/O. The host app wires send +
 * receive via the existing useBorjieChat hook from
 * `@borjie/chat-ui/borjie/useBorjieChat` (re-exported through the
 * package barrel). For the spec wave, HomeShell ships with a local
 * stub state to make the scaffold renderable + testable without
 * additional wiring.
 *
 * Spec: HOME_DASHBOARD_STANDARD.md (Wave 18W).
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  ChatMessage,
  HomeShellProps,
  HomeShellState,
  ProactiveProposal,
  ResolvedAgent,
} from './types.js';
import {
  defaultSurfaceForRole,
  resolveAudience,
} from './resolve/audience-resolver.js';
import { PersonaHeader } from './PersonaHeader.js';
import { HomeComposer } from './HomeComposer.js';
import { HomeMessageList } from './HomeMessageList.js';
import { HomeProactiveBanner } from './HomeProactiveBanner.js';
import { HistoryRail, type HistoryRailConversation } from './history-rail/HistoryRail.js';

const SHELL_STYLE_FULL: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-background, #ffffff)',
  fontFamily: 'inherit',
};

const SHELL_STYLE_SPLIT: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100vh',
  display: 'flex',
  flexDirection: 'row',
  background: 'var(--color-background, #ffffff)',
  fontFamily: 'inherit',
};

const MAIN_COLUMN: CSSProperties = {
  flex: 1,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const PLACEHOLDER_HISTORY: ReadonlyArray<HistoryRailConversation> = [];

function emptyStateFor(agent: ResolvedAgent, language: 'en' | 'sw' | 'fr'): string {
  if (language === 'sw') {
    return `Habari, mimi ni ${agent.display_name}. Niulize chochote.`;
  }
  if (language === 'fr') {
    return `Bonjour, je suis ${agent.display_name}. Posez-moi vos questions.`;
  }
  return `Hi, I'm ${agent.display_name} — ${agent.title}. Ask me anything.`;
}

function composerPlaceholder(language: 'en' | 'sw' | 'fr'): string {
  if (language === 'sw') return 'Andika hapa…';
  if (language === 'fr') return 'Écrivez ici…';
  return 'Type here…';
}

function makeConversationId(): string {
  // Use crypto.randomUUID where available (browsers + Node 19+). The
  // server overwrites this with the canonical ID via Phase-2 wiring;
  // this stub is renderer-only.
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `home-${globalThis.crypto.randomUUID()}`;
  }
  return `home-${Date.now().toString(36)}`;
}

function makeMessageId(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `msg-${globalThis.crypto.randomUUID()}`;
  }
  return `msg-${Date.now().toString(36)}`;
}

export function HomeShell(props: HomeShellProps): JSX.Element {
  const {
    user_role,
    initial_persona_override,
    surface_override,
    variant,
    enable_proactive_banners,
    enable_dashboard_link,
    initial_language,
    onOpenDashboard,
    onAcceptProposal,
    onDismissProposal,
  } = props;

  const surface = surface_override ?? defaultSurfaceForRole(user_role);

  const resolved_agent = useMemo(
    () =>
      resolveAudience({
        user_role,
        surface,
        persona_override: initial_persona_override,
      }),
    [user_role, surface, initial_persona_override],
  );

  const [state, setState] = useState<HomeShellState>(() => ({
    resolved_agent,
    conversation_id: makeConversationId(),
    messages: [],
    streaming: false,
    pending_proposals: [],
  }));

  // Keep resolved_agent in state in sync with prop changes.
  useEffect(() => {
    setState((prev) => ({ ...prev, resolved_agent }));
  }, [resolved_agent]);

  const handleSend = useCallback((text: string) => {
    const next: ChatMessage = {
      id: makeMessageId(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, next],
    }));
  }, []);

  const dismissProposal = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        pending_proposals: prev.pending_proposals.filter((p) => p.id !== id),
      }));
      if (onDismissProposal) onDismissProposal(id);
    },
    [onDismissProposal],
  );

  const acceptProposal = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        pending_proposals: prev.pending_proposals.filter((p) => p.id !== id),
      }));
      if (onAcceptProposal) onAcceptProposal(id);
    },
    [onAcceptProposal],
  );

  const proposalsToShow: ReadonlyArray<ProactiveProposal> =
    enable_proactive_banners ? state.pending_proposals : [];

  const shellStyle =
    variant === 'split_with_history' ? SHELL_STYLE_SPLIT : SHELL_STYLE_FULL;

  return (
    <div data-testid="home-shell" style={shellStyle}>
      {variant === 'split_with_history' ? (
        <HistoryRail
          conversations={PLACEHOLDER_HISTORY}
          active_id={state.conversation_id}
          onSelect={() => {
            /* host wiring pending; see Phase 2 spec */
          }}
        />
      ) : null}
      <div style={MAIN_COLUMN}>
        <PersonaHeader
          agent={state.resolved_agent}
          enable_dashboard_link={enable_dashboard_link}
          onOpenDashboard={onOpenDashboard}
        />
        <HomeProactiveBanner
          proposals={proposalsToShow}
          onAccept={acceptProposal}
          onDismiss={dismissProposal}
        />
        <HomeMessageList
          messages={state.messages}
          emptyState={emptyStateFor(state.resolved_agent, initial_language)}
        />
        <HomeComposer
          onSend={handleSend}
          disabled={state.streaming}
          placeholder={composerPlaceholder(initial_language)}
        />
      </div>
    </div>
  );
}
