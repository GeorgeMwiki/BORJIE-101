/**
 * Cross-channel conversation state-sync (LP-25).
 *
 * Keeps one conversation coherent as a person hops channels: a manager might
 * start an exchange on WhatsApp, get cut off when the 24-hour window lapses,
 * and resume on the web. This engine records turns, tracks per-channel
 * session windows (notably WhatsApp's 24h customer-care window), and applies
 * handoffs — all over an injected {@link ConversationStore}, immutably.
 *
 * Pure transforms + a store port. No Redis import here; the host injects a
 * Redis/Upstash-backed store with a TTL in production.
 *
 * @module @borjie/channel-gateway/state-sync
 */

import {
  DEFAULT_MAX_TURNS,
  WHATSAPP_WINDOW_MS,
  type ChannelEvent,
  type ChannelKind,
  type ChannelSession,
  type ConversationState,
  type ConversationTurn,
  type HandoffResult,
} from './types.js';
import { systemClock, type Clock, type ConversationStore } from './ports.js';

export interface StateSyncDeps {
  readonly store: ConversationStore;
  readonly clock?: Clock;
  /** Max retained turns before the oldest are dropped. Default 50. */
  readonly maxTurns?: number;
}

export interface StateSync {
  get(conversationId: string): Promise<ConversationState | null>;
  /** Create-or-get the conversation for an event, recording the user turn. */
  ingest(conversationId: string, event: ChannelEvent): Promise<ConversationState>;
  /** Append an assistant reply on a given channel. */
  appendAssistant(
    conversationId: string,
    channel: ChannelKind,
    text: string,
    turnId?: string,
  ): Promise<ConversationState | null>;
  /** Move the conversation's active channel, refreshing window state. */
  handoff(
    conversationId: string,
    toChannel: ChannelKind,
    toIdentifier: string,
  ): Promise<HandoffResult | null>;
  /** True iff the WhatsApp 24h free-message window is open for this convo. */
  isWhatsAppWindowOpen(conversationId: string): Promise<boolean>;
}

// ----------------------------------------------------------------------------
// Pure helpers
// ----------------------------------------------------------------------------

function identifierFor(event: ChannelEvent): string {
  return (
    event.sender.raw.phone ??
    event.sender.raw.email ??
    event.sender.raw.webUserId ??
    'unknown'
  );
}

function withWindow(
  channel: ChannelKind,
  base: Omit<ChannelSession, 'windowExpiresAt'>,
  now: Date,
): ChannelSession {
  if (channel === 'whatsapp') {
    return {
      ...base,
      windowExpiresAt: new Date(now.getTime() + WHATSAPP_WINDOW_MS).toISOString(),
    };
  }
  return base;
}

function touchSession(
  sessions: readonly ChannelSession[],
  channel: ChannelKind,
  identifier: string,
  now: Date,
): readonly ChannelSession[] {
  const iso = now.toISOString();
  const existing = sessions.find((s) => s.channel === channel);
  if (existing) {
    const updated: ChannelSession = withWindow(
      channel,
      {
        channel,
        identifier: existing.identifier || identifier,
        firstContactAt: existing.firstContactAt,
        lastContactAt: iso,
        messageCount: existing.messageCount + 1,
      },
      now,
    );
    return sessions.map((s) => (s.channel === channel ? updated : s));
  }
  const created: ChannelSession = withWindow(
    channel,
    {
      channel,
      identifier,
      firstContactAt: iso,
      lastContactAt: iso,
      messageCount: 1,
    },
    now,
  );
  return [...sessions, created];
}

function appendTurn(
  turns: readonly ConversationTurn[],
  turn: ConversationTurn,
  maxTurns: number,
): readonly ConversationTurn[] {
  const next = [...turns, turn];
  return next.length > maxTurns ? next.slice(next.length - maxTurns) : next;
}

// ----------------------------------------------------------------------------
// Engine
// ----------------------------------------------------------------------------

export function createStateSync(deps: StateSyncDeps): StateSync {
  const clock = deps.clock ?? systemClock;
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;

  const get = (conversationId: string): Promise<ConversationState | null> =>
    deps.store.get(conversationId);

  const ingest = async (
    conversationId: string,
    event: ChannelEvent,
  ): Promise<ConversationState> => {
    const now = clock.now();
    const identifier = identifierFor(event);
    const existing = await deps.store.get(conversationId);

    const turn: ConversationTurn = {
      id: `${event.eventId}`,
      role: 'user',
      channel: event.channel,
      text: event.text,
      at: now.toISOString(),
    };

    const base: ConversationState = existing ?? {
      conversationId,
      tenantId: event.sender.tenantId,
      actorId: event.sender.actorId,
      lastChannel: event.channel,
      lastActivityAt: now.toISOString(),
      turns: [],
      channelSessions: [],
    };

    const next: ConversationState = {
      ...base,
      // Late-binding tenant/actor: once a sender resolves, lock it in.
      tenantId: base.tenantId ?? event.sender.tenantId,
      actorId: base.actorId ?? event.sender.actorId,
      lastChannel: event.channel,
      lastActivityAt: now.toISOString(),
      turns: appendTurn(base.turns, turn, maxTurns),
      channelSessions: touchSession(base.channelSessions, event.channel, identifier, now),
    };

    await deps.store.put(next);
    return next;
  };

  const appendAssistant = async (
    conversationId: string,
    channel: ChannelKind,
    text: string,
    turnId?: string,
  ): Promise<ConversationState | null> => {
    const existing = await deps.store.get(conversationId);
    if (!existing) return null;
    const now = clock.now();
    const turn: ConversationTurn = {
      id: turnId ?? `asst-${now.getTime()}`,
      role: 'assistant',
      channel,
      text,
      at: now.toISOString(),
    };
    const next: ConversationState = {
      ...existing,
      lastChannel: channel,
      lastActivityAt: now.toISOString(),
      turns: appendTurn(existing.turns, turn, maxTurns),
    };
    await deps.store.put(next);
    return next;
  };

  const handoff = async (
    conversationId: string,
    toChannel: ChannelKind,
    toIdentifier: string,
  ): Promise<HandoffResult | null> => {
    const existing = await deps.store.get(conversationId);
    if (!existing) return null;
    const now = clock.now();
    const fromChannel = existing.lastChannel;
    const next: ConversationState = {
      ...existing,
      lastChannel: toChannel,
      lastActivityAt: now.toISOString(),
      channelSessions: touchSession(existing.channelSessions, toChannel, toIdentifier, now),
    };
    await deps.store.put(next);
    return { state: next, fromChannel, toChannel };
  };

  const isWhatsAppWindowOpen = async (conversationId: string): Promise<boolean> => {
    const existing = await deps.store.get(conversationId);
    if (!existing) return false;
    const wa = existing.channelSessions.find((s) => s.channel === 'whatsapp');
    if (!wa?.windowExpiresAt) return false;
    const expires = Date.parse(wa.windowExpiresAt);
    if (!Number.isFinite(expires)) return false;
    return clock.now().getTime() <= expires;
  };

  return { get, ingest, appendAssistant, handoff, isWhatsAppWindowOpen };
}
