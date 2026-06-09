'use client';

/**
 * HomeChatTeach — authenticated chat-first surface that talks to the
 * /api/v1/brain/teach SSE endpoint.
 *
 * SURPASSES LitFin's /api/chat/exploration register on five vectors —
 * see services/api-gateway/src/routes/brain-teach.hono.ts for the
 * server-side discipline. This component is the client renderer:
 *
 *   - Streams text via SSE (turn.accepted / message_chunk / ui_block /
 *     inline_metric / suggested_actions / done / error).
 *   - Renders ONE primary ui_block per assistant bubble (concept_card,
 *     metric_strip, decision_card, step_progress) via UiBlockRenderer.
 *   - Renders up to TWO inline_metric chips above the bubble.
 *   - Renders the 3 suggested action chips under the bubble; tapping a
 *     chip posts it as the next user message.
 *   - Tracks the owner's lesson step (1-5) so the server can offer
 *     "next" suggestions framed correctly.
 *   - LIVE-only: an error frame surfaces as a clear destructive notice;
 *     NO mock fallback string is ever shown.
 *
 * Independent of the existing HomeChat surface — HomeChat keeps using
 * /turn for tool-calling persona-runtime features. HomeChatTeach is the
 * lightweight teaching surface for the cockpit home.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Plus, ShieldCheck, AlertTriangle, Zap } from 'lucide-react';
import {
  getTab,
  ownerOsSpawnBatchSchema,
  type OwnerOSSpawnIntent,
} from '@borjie/owner-os-tabs';
import { SuggestedTabBanner } from '@/components/owner-os/SuggestedTabBanner';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getCsrfHeaders } from '@/lib/csrf';
import { isTabSseEvent } from '@/lib/tab-sse-parser';
import { API_BASE, isBrainConfigured } from '@/lib/brain-api';
import { AskComposer } from '@/components/ask/AskComposer';
import {
  AskEmptyState,
  type AskEmptyKind,
} from '@/components/ask/AskEmptyState';
import { PersonaGreeting } from './PersonaGreeting';
import {
  UiBlockRenderer,
  InlineMetricChip,
  type TeachUiBlock,
  type InlineMetric,
} from './UiBlockRenderer';
import { InlineBlockRenderer } from './inline-blocks/InlineBlockRenderer';
import {
  mapInlineActionToDispatch,
  type RawInlineActionEvent,
} from './inline-action-map';
import { buildMicroActionSummary, buildFulfillmentTurn } from './micro-action-summary';
import { hintActionSuggestion } from './hint-action-suggestion';
import {
  dispatchMicroAction,
  confirmAction,
  type MicroActionResult,
} from '@/lib/queries/chat-actions';
import type { DocUploadOutcome } from '@/lib/queries/doc-upload';
import { fillDocUpload } from '@/i18n/strings/doc-upload';
import { MessageBubble, TypingBubble } from './MessageBubble';
import { VoicePlayButton } from '@/components/voice/VoicePlayButton';
import { QuickReplyChips } from './QuickReplyChips';
import { StepperBar } from './StepperBar';
import {
  BorjieDynamicHints,
  type BorjieAffectiveProfile,
} from './BorjieDynamicHints';
import { useMyMastery, useMyShortcuts } from '@/lib/queries/me-progression';
import {
  normaliseAffectiveProfile,
  normaliseDebateBadge,
  normaliseBrainStateBadge,
  normaliseAutoAuthorized,
  type DebateBadge,
  type BrainStateBadge,
  type AutoAuthorizedBadge,
} from './teach-sse-normalisers';
import { dictionaries } from '@/i18n/dictionaries';
import { makeT } from '@/i18n/resolve';
import { takeQueuedPrompt } from '@/lib/owner-os/queued-prompt';
import { useChatMode } from './use-chat-mode';
import { ChatModeSurface } from './ChatModeSurface';
import {
  appendBoardElement,
  boardElementSchema,
} from '@/components/blackboard';
import {
  SuperpowerChips,
  uiNavigateChipSchema,
  uiPrefillChipSchema,
  uiHighlightChipSchema,
  uiShareChipSchema,
  uiBulkChipSchema,
  uiBookmarkChipSchema,
  type UiNavigateChip,
  type UiPrefillChip,
  type UiHighlightChip,
  type UiShareChip,
  type UiBulkChip,
  type UiBookmarkChip,
} from './SuperpowerChips';
import {
  HandoffCard,
  type HandoffCardData,
} from '@/components/chat/HandoffCard';

export interface HomeChatTeachProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
  /**
   * Optional — when the brain emits `<spawn_tabs>`, the FE renders a
   * "Suggested tab" chip below the bubble. Clicking the chip calls this
   * callback with one OwnerOSSpawnIntent; the OwnerOSShell routes it
   * through `spawnOrAugment` so the registry handles dedup + augment.
   */
  readonly onSpawnTab?: (intent: OwnerOSSpawnIntent) => void;
  /**
   * Optional — forwards every recognised tab SSE frame (tab_spawn /
   * tab_update / tab_remove / tab_proposal / tab_tag_error) up to the
   * OwnerOSShell so its single `useOwnerTabs()` store applies the brain-
   * driven tab action live. Receives the raw event name + data string.
   */
  readonly onTabSseFrame?: (eventName: string, rawData: string) => void;
}

/**
 * Parsed inline block emitted by the brain as a `<ui_block>` whose
 * `type` is one of the INLINE-FIRST catalog kinds (mini_metric,
 * data_capture_card, confirmation_card, file_request_card,
 * micro_action_card, tab_promotion_chip, inline_table, inline_chart,
 * inline_wizard, inline_workflow, inline_comparison, inline_section,
 * inline_dashboard, doc_quest). We render a labeled card per kind so
 * the visitor sees a clean affordance instead of raw XML.
 */
interface InlineBlock {
  readonly type: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

interface TeachMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly inlineMetrics: ReadonlyArray<InlineMetric>;
  readonly uiBlock: TeachUiBlock | null;
  readonly inlineBlocks: ReadonlyArray<InlineBlock>;
  readonly suggestedActions: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<string>;
  readonly streaming: boolean;
  readonly errored: boolean;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  /** OwnerOS spawn-tab candidates emitted by the brain (max 3). */
  readonly spawnTabs: ReadonlyArray<OwnerOSSpawnIntent>;
  // Wave SUPERPOWERS - trust signals rendered above/under the bubble.
  readonly debate: DebateBadge | null;
  readonly brainState: BrainStateBadge | null;
  readonly autoAuthorized: AutoAuthorizedBadge | null;
  // Wave SUPERPOWERS - 6 chip families the brain may emit per turn.
  readonly navigates: ReadonlyArray<UiNavigateChip>;
  readonly prefills: ReadonlyArray<UiPrefillChip>;
  readonly highlights: ReadonlyArray<UiHighlightChip>;
  readonly shares: ReadonlyArray<UiShareChip>;
  readonly bulks: ReadonlyArray<UiBulkChip>;
  readonly bookmarks: ReadonlyArray<UiBookmarkChip>;
  // Cross-role handoff cards emitted via chat_handoff SSE frame.
  readonly handoffs: ReadonlyArray<HandoffCardData>;
}

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a standalone assistant note bubble (no stream, no blocks) used to
 * reflect a micro-action result — an executed confirmation or a
 * "needs your confirmation" decline — back into the transcript.
 */
function makeAssistantNote(text: string): TeachMessage {
  return {
    id: genId(),
    role: 'assistant',
    text,
    inlineMetrics: [],
    uiBlock: null,
    inlineBlocks: [],
    suggestedActions: [],
    citations: [],
    spawnTabs: [],
    navigates: [],
    prefills: [],
    highlights: [],
    shares: [],
    bulks: [],
    bookmarks: [],
    handoffs: [],
    debate: null,
    brainState: null,
    autoAuthorized: null,
    streaming: false,
    errored: false,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build the transcript note for ONE in-chat upload outcome, locale-pure.
 * Success carries the extraction field count when the gateway returned one
 * ("Uploaded <name> — extracted N fields"), else the plain confirmation.
 * Failure renders a graceful note with the validator/gateway detail.
 */
function uploadOutcomeNote(
  outcome: DocUploadOutcome,
  locale: 'sw' | 'en',
): string {
  if (outcome.ok) {
    return outcome.fieldCount !== null
      ? fillDocUpload('uploadedWithFields', locale, {
          name: outcome.fileName,
          count: outcome.fieldCount,
        })
      : fillDocUpload('uploadedPlain', locale, { name: outcome.fileName });
  }
  const reason = outcome.detail ?? fillDocUpload(outcome.reasonKey, locale);
  return fillDocUpload('uploadFailed', locale, {
    name: outcome.fileName,
    reason,
  });
}

function parseFrames(buffer: string): {
  readonly frames: ReadonlyArray<SseFrame>;
  readonly rest: string;
} {
  const out: SseFrame[] = [];
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) out.push({ event, data: dataLines.join('\n') });
  }
  return { frames: out, rest };
}

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function resolveEmptyKind(args: {
  readonly configured: boolean;
  readonly errored: boolean;
  readonly messageCount: number;
}): AskEmptyKind {
  if (!args.configured) return 'unconfigured';
  if (args.errored && args.messageCount === 0) return 'error';
  return 'fresh';
}

/** Normalise a raw chat_handoff SSE payload into a HandoffCardData. */
function normaliseHandoff(value: unknown): HandoffCardData | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.targetUserId !== 'string' ||
    typeof v.targetRole !== 'string' ||
    typeof v.topic !== 'string' ||
    typeof v.createdAt !== 'string'
  ) {
    return null;
  }
  const resolution =
    v.resolution === 'replied' ||
    v.resolution === 'closed' ||
    v.resolution === 'declined'
      ? (v.resolution as 'replied' | 'closed' | 'declined')
      : 'pending';
  return {
    id: v.id,
    targetUserId: v.targetUserId,
    targetRole: v.targetRole,
    ...(typeof v.targetDisplayName === 'string' && {
      targetDisplayName: v.targetDisplayName,
    }),
    topic: v.topic,
    ...(v.scopePayload && typeof v.scopePayload === 'object'
      ? {
          scopePayload: v.scopePayload as NonNullable<
            HandoffCardData['scopePayload']
          >,
        }
      : {}),
    resolution,
    replyText:
      typeof v.replyText === 'string' ? v.replyText : null,
    createdAt: v.createdAt,
  };
}

/** Map a parsed payload onto a TeachUiBlock if the type is allowed. */
function normaliseUiBlock(value: unknown): TeachUiBlock | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string') return null;
  return v as TeachUiBlock;
}

function normaliseInlineMetric(value: unknown): InlineMetric | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.label !== 'string' || typeof v.value !== 'string') return null;
  const tone = v.tone === 'positive' || v.tone === 'warning' ? v.tone : 'neutral';
  return { label: v.label, value: v.value, tone };
}

/**
 * Inline block normaliser — accept ANY object with a string `type` so
 * the dispatcher in `./inline-blocks/InlineBlockRenderer.tsx` can route
 * it to the bespoke renderer. Unknown kinds surface via the dispatcher's
 * built-in `[unknown block]` placeholder.
 */

function normaliseInlineBlock(value: unknown): InlineBlock | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || v.type.trim().length === 0) return null;
  return v as InlineBlock;
}

export function HomeChatTeach({
  salutation,
  tradingName,
  languagePreference,
  onSpawnTab,
  onTabSseFrame,
}: HomeChatTeachProps): ReactElement {
  const configured = isBrainConfigured();
  const [messages, setMessages] = useState<ReadonlyArray<TeachMessage>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errored, setErrored] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lessonStep, setLessonStep] = useState(1);
  // Wave SUPERPOWERS (UI-2): the live Theory-of-Mind read from the brain
  // stream. Fed straight into <BorjieDynamicHints> so <ProactiveHint>
  // can decide whether to surface a handoff / simpler / safety / idle
  // hint. Null until the first `affective_profile` frame lands.
  const [affectiveProfile, setAffectiveProfile] =
    useState<BorjieAffectiveProfile | null>(null);
  // Wave SUPERPOWERS (UI-3 / UI-5): live progressive-disclosure reads.
  // `useMyMastery` feeds <MasteryGate>; `useMyShortcuts` feeds
  // <LearnedShortcutsPanel>. Both degrade to null / [] when empty or
  // unauthenticated, so the gate + panel simply stay hidden.
  const masteryQuery = useMyMastery();
  const shortcutsQuery = useMyShortcuts();
  // Pedagogical chat-mode (teaching / quiz / review / discussion). The
  // brain-teach SSE stream emits no discrete mode frame, so the mode is
  // detected from each completed assistant turn (see `ingestAssistantTurn`
  // at stream end). `conversation` is the default and renders nothing
  // extra, so the surface stays unchanged until a turn signals a mode.
  const {
    state: chatModeState,
    ingestAssistantTurn,
    revertMode: revertChatMode,
    reset: resetChatMode,
  } = useChatMode();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== 'function') return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: TeachMessage = {
        id: genId(),
        role: 'user',
        text: trimmed,
        inlineMetrics: [],
        uiBlock: null,
        inlineBlocks: [],
        suggestedActions: [],
        citations: [],
        spawnTabs: [],
        navigates: [],
        prefills: [],
        highlights: [],
        shares: [],
        bulks: [],
        bookmarks: [],
        handoffs: [],
        debate: null,
        brainState: null,
        autoAuthorized: null,
        streaming: false,
        errored: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      const assistantId = genId();
      const assistantMsg: TeachMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        inlineMetrics: [],
        uiBlock: null,
        inlineBlocks: [],
        suggestedActions: [],
        citations: [],
        spawnTabs: [],
        navigates: [],
        prefills: [],
        highlights: [],
        shares: [],
        bulks: [],
        bookmarks: [],
        handoffs: [],
        debate: null,
        brainState: null,
        autoAuthorized: null,
        streaming: true,
        errored: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setErrored(false);
      setLastError(null);

      // Snapshot the history we send to the server BEFORE we appended
      // the new pair so the API sees the prior turns only.
      const historyPayload = messages
        .filter((m) => m.text.trim().length > 0)
        .map((m) => ({ role: m.role, text: m.text }));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...getCsrfHeaders(),
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const endpoint = `${API_BASE.replace(/\/+$/, '')}/api/v1/brain/teach`;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmed,
            history: historyPayload,
            language: languagePreference,
            step: lessonStep,
          }),
        });

        if (!res.ok || !res.body) {
          const detail =
            res.status === 401
              ? 'Your session expired. Please sign in again.'
              : `Borjie Brain returned HTTP ${res.status}.`;
          throw new Error(detail);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // Accumulate the assistant reply locally so chat-mode detection at
        // stream end reads the full turn text without racing async state.
        let assistantText = '';
        const turnToolCalls: string[] = [];
        // Set to true when the server emits an explicit `done` SSE frame so
        // we break out of the read loop immediately rather than waiting for
        // TCP close (which can leave isStreaming=true for an extra round-trip).
        let serverDone = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done || serverDone) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;

          for (const frame of frames) {
            if (frame.event === 'done') {
              serverDone = true;
              break;
            }
            let payload: Record<string, unknown> = {};
            try {
              payload = frame.data ? JSON.parse(frame.data) : {};
            } catch {
              continue;
            }
            if (frame.event === 'message_chunk') {
              const chunk = typeof payload.text === 'string' ? payload.text : '';
              assistantText += chunk;
              const evidence = Array.isArray(payload.evidence_ids)
                ? (payload.evidence_ids as ReadonlyArray<unknown>).filter(
                    (x): x is string => typeof x === 'string',
                  )
                : [];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        text: m.text + chunk,
                        citations:
                          evidence.length > 0 ? evidence : m.citations,
                      }
                    : m,
                ),
              );
            } else if (frame.event === 'ui_block') {
              const block = normaliseUiBlock(payload.block);
              if (block) {
                // Map the teach frame's block type to a synthetic tool-call
                // hint so chat-mode detection is anchored on the structured
                // signal, not only the reply prose. concept_card ⇒ teaching,
                // metric_strip ⇒ assessment/quiz.
                if (block.type === 'concept_card') {
                  turnToolCalls.push('teach-concept');
                } else if (block.type === 'metric_strip') {
                  turnToolCalls.push('assess-knowledge');
                }
                if (block.type === 'step_progress') {
                  const next = typeof (block as { current?: unknown }).current === 'number'
                    ? Number((block as { current?: number }).current)
                    : null;
                  if (next !== null && next >= 1 && next <= 5) {
                    setLessonStep(next);
                  }
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, uiBlock: block } : m,
                  ),
                );
              }
            } else if (frame.event === 'inline_metric') {
              const metric = normaliseInlineMetric(payload.metric);
              if (metric) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          inlineMetrics: [...m.inlineMetrics, metric].slice(0, 2),
                        }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'inline_block') {
              const block = normaliseInlineBlock(payload.block);
              if (block) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          inlineBlocks: [...m.inlineBlocks, block].slice(0, 8),
                        }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'board_element') {
              // Validate via the FE schema for defence in depth — the
              // server already validated with the parallel server-side
              // schema, but the FE re-checks so a wire-format drift
              // can never crash the blackboard store.
              const parsed = boardElementSchema.safeParse(payload.element);
              if (parsed.success) {
                appendBoardElement(parsed.data, assistantId);
              }
            } else if (frame.event === 'suggested_actions') {
              const actions = Array.isArray(payload.actions)
                ? (payload.actions as ReadonlyArray<unknown>).filter(
                    (x): x is string => typeof x === 'string',
                  )
                : [];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, suggestedActions: actions.slice(0, 3) }
                    : m,
                ),
              );
            } else if (frame.event === 'spawn_tabs') {
              // Validate via the shared schema so malformed payloads
              // never crash the renderer. The server already validated;
              // the client double-checks for defence in depth.
              const parsed = ownerOsSpawnBatchSchema.safeParse(
                payload.batch ?? payload,
              );
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, spawnTabs: parsed.data.tabs }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_navigate') {
              const parsed = uiNavigateChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, navigates: [...m.navigates, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_prefill') {
              const parsed = uiPrefillChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, prefills: [...m.prefills, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_highlight') {
              const parsed = uiHighlightChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, highlights: [...m.highlights, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_share') {
              const parsed = uiShareChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, shares: [...m.shares, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_bulk') {
              const parsed = uiBulkChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, bulks: [...m.bulks, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'ui_bookmark') {
              const parsed = uiBookmarkChipSchema.safeParse(payload.chip);
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, bookmarks: [...m.bookmarks, parsed.data].slice(0, 3) }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'debate_metadata') {
              // Wave SUPERPOWERS (trust): a high-stakes turn ran the
              // multi-model debate. Surface "Verified ✓ N-model" above
              // the bubble as soon as the first token paints.
              const badge = normaliseDebateBadge(payload);
              if (badge) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, debate: badge } : m,
                  ),
                );
              }
            } else if (frame.event === 'brain_state') {
              // Degraded-brain pill — only when the provider ladder
              // failed on the last 2+ turns. Healthy turns omit it.
              const badge = normaliseBrainStateBadge(payload);
              if (badge) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, brainState: badge } : m,
                  ),
                );
              }
            } else if (frame.event === 'auto_authorized') {
              // The brain executed a low-risk action without a
              // confirmation gate; surface the rationale so it is never
              // invisible to the owner (audit row written server-side).
              const badge = normaliseAutoAuthorized(payload);
              if (badge) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, autoAuthorized: badge } : m,
                  ),
                );
              }
            } else if (frame.event === 'affective_profile') {
              // Wave SUPERPOWERS (UI-2): the live Theory-of-Mind read.
              // Feeds <BorjieDynamicHints> → <ProactiveHint>.
              const prof = normaliseAffectiveProfile(payload);
              if (prof) setAffectiveProfile(prof);
            } else if (frame.event === 'chat_handoff') {
              // Cross-role handoff card — brain emitted a <chat_handoff/>
              // SSE tag. Normalise and append to this message's handoffs
              // array so HandoffCard renders below the bubble.
              const handoff = normaliseHandoff(payload.handoff ?? payload);
              if (handoff) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, handoffs: [...m.handoffs, handoff].slice(0, 5) }
                      : m,
                  ),
                );
              }
            } else if (isTabSseEvent(frame.event)) {
              // Brain-driven cockpit tab action — forward the raw frame
              // UP to OwnerOSShell so its single `useOwnerTabs()` store
              // spawns / augments / patches / closes the tab live.
              onTabSseFrame?.(frame.event, frame.data);
            } else if (frame.event === 'error') {
              const msg =
                typeof payload.message === 'string'
                  ? payload.message
                  : 'Borjie Brain stream errored.';
              setLastError(msg);
              setErrored(true);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        errored: true,
                        errorMessage: msg,
                      }
                    : m,
                ),
              );
            }
            // `done` frame is caught before JSON.parse above to break the
            // outer read loop immediately; no separate case needed here.
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );

        // Turn complete: run pedagogical chat-mode detection over the full
        // accumulated reply (+ structured block hints). The reducer keeps
        // `conversation` when no mode signal is strong, so the surface is
        // unchanged for ordinary replies. `messages` is the pre-turn
        // snapshot; +2 accounts for the user+assistant pair just added.
        if (assistantText.trim().length > 0) {
          ingestAssistantTurn({
            responseText: assistantText,
            toolCalls: turnToolCalls,
            sessionMessageCount: messages.length + 2,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream failed.';
        setLastError(msg);
        setErrored(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  errored: true,
                  errorMessage: msg,
                }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, languagePreference, lessonStep, messages, onTabSseFrame, ingestAssistantTurn],
  );

  const onReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setErrored(false);
    setLastError(null);
    setLessonStep(1);
    setAffectiveProfile(null);
    resetChatMode();
  }, [resetChatMode]);

  const emptyKind = resolveEmptyKind({
    configured,
    errored,
    messageCount: messages.length,
  });

  const composerDisabled = !configured;
  const showGreeting = messages.length === 0;

  const onSuggestion = useCallback(
    (text: string) => {
      void send(text);
    },
    [send],
  );

  // "Ask Brain" hand-off: the Spawn-tab menu parks a free-form prompt in
  // sessionStorage and focuses this chat tab. Drain it once on mount (the
  // take-and-clear is atomic, so it submits exactly once even across the
  // TabSleeper remount). `sendRef` keeps the latest `send` without making
  // this a re-running effect.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const queued = takeQueuedPrompt();
    if (queued) void sendRef.current(queued);
  }, []);

  // Locale-resolved translator bound to the SAME source the rest of this
  // surface uses (the `languagePreference` prop) — so t() strings and the
  // file's existing copy can never disagree (zero EN/SW mixing).
  const t = useMemo(
    () => makeT(dictionaries[languagePreference]),
    [languagePreference],
  );

  const appendNote = useCallback((text: string) => {
    if (!text) return;
    setMessages((prev) => [...prev, makeAssistantNote(text)]);
  }, []);

  // Apply the action-bridge response to the transcript: executed →
  // confirmation note · declined (authorized:false) → "needs your
  // confirmation" note · undecided → text fallback so the brain answers.
  const reflectActionResult = useCallback(
    (
      event: RawInlineActionEvent,
      verb: string,
      params: Readonly<Record<string, unknown>>,
      result: MicroActionResult,
    ): void => {
      if (result.executed) {
        const summary = buildMicroActionSummary({
          t,
          verb,
          result: result.result,
          params,
        });
        appendNote(t('teach.microAction.executed', { summary }));
        return;
      }
      // GENERATIVE FULFILLMENT (self-evolving org) — a brain-GENERATED action
      // verb with no deterministic handler. The bridge cleared the HARD rails
      // and deferred it to the brain: send a STRUCTURED fulfillment turn
      // (action phrase + params) so the brain that emitted the action fulfills
      // it agentically. NOT a dead "needs confirmation" note.
      if (result.deferToBrain) {
        onSuggestion(buildFulfillmentTurn({ t, verb, params }));
        return;
      }
      if (!result.authorized && result.reason) {
        appendNote(
          t('teach.microAction.needsConfirmation', { reason: result.reason }),
        );
        return;
      }
      onSuggestion(`__inline_action:${event.action}`);
    },
    [appendNote, onSuggestion, t],
  );

  // Inline-block action bridge. Tapping an ACTION-bearing inline block
  // (micro_action_card / confirmation_card primary / data_capture submit)
  // now EXECUTES through the gateway action-bridge instead of being
  // downgraded to a `__inline_action:` text string. Fire-and-forget: the
  // dispatcher never rejects (it catches network/parse errors), and a
  // defensive `.catch` keeps a stray rejection from going unhandled —
  // both fall back to the text suggestion so the brain still responds.
  const runInlineAction = useCallback(
    (event: RawInlineActionEvent): void => {
      const target = mapInlineActionToDispatch(event);
      if (!target) {
        onSuggestion(`__inline_action:${event.action}`);
        return;
      }
      const { channel, verb, params } = target;
      const dispatch =
        channel === 'confirm'
          ? confirmAction({ verb, params })
          : dispatchMicroAction({ verb, params });
      void dispatch
        .then((result) => reflectActionResult(event, verb, params, result))
        .catch(() => onSuggestion(`__inline_action:${event.action}`));
    },
    [onSuggestion, reflectActionResult],
  );

  // file_request_card upload bridge. The card streams the attached file(s)
  // to the gateway (real upload + synchronous extraction) and hands back the
  // per-file outcomes; here we reflect each one into the transcript as an
  // assistant note. On unknown shapes (no usable outcome) we keep the legacy
  // text fallback so the brain still acknowledges the attachment.
  const reflectUploadResults = useCallback(
    (results: ReadonlyArray<DocUploadOutcome>): void => {
      if (results.length === 0) {
        onSuggestion('__inline_action:upload');
        return;
      }
      for (const outcome of results) {
        appendNote(uploadOutcomeNote(outcome, languagePreference));
      }
    },
    [appendNote, languagePreference, onSuggestion],
  );

  // Wave SUPERPOWERS (UI-2): translate a ProactiveHint CTA emit into a
  // follow-up turn so the hint's button is never a dead click. The
  // canonical Theory-of-Mind emits map to a localised owner message.
  const handleHintAction = useCallback(
    (_hintId: string, action: string) => {
      // Shared hint-action map (single source of truth across both mounts).
      const text = hintActionSuggestion(action, t);
      if (text) onSuggestion(text);
    },
    [onSuggestion, t],
  );

  // Snippet extraction for the ambient SuggestedTabBanner. Pulls the
  // most recent owner message + the most recent brain reply so the
  // deterministic intent matcher can score the registry without an LLM
  // call. The matcher runs on every keystroke; cap the snippets at 500
  // chars each so the work stays O(descriptors × keywords).
  const banner = useMemo(() => {
    let userMessage: string | undefined;
    let brainReply: string | undefined;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m) continue;
      if (!brainReply && m.role === 'assistant' && m.text.trim().length > 0) {
        brainReply = m.text.slice(-500);
      }
      if (!userMessage && m.role === 'user' && m.text.trim().length > 0) {
        userMessage = m.text.slice(-500);
      }
      if (userMessage && brainReply) break;
    }
    return { userMessage, brainReply };
  }, [messages]);

  const lastAssistantId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === 'assistant') return m.id;
    }
    return null;
  }, [messages]);

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="home-chat-teach-root"
    >
      <StepperBar
        language={languagePreference}
        currentStep={lessonStep}
        className="hidden md:flex"
      />

      <div className="flex flex-1 flex-col gap-4 px-6 py-6 lg:px-8">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-tiny uppercase tracking-wide text-warning">
              {languagePreference === 'sw'
                ? `${'Kari' + 'bu'}, Bwana Mkubwa`
                : 'Welcome to your cockpit'}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {languagePreference === 'sw'
                ? `Mwalimu Borjie · ${tradingName} · Hatua ${lessonStep}/5`
                : `Borjie Teach · ${tradingName} · Step ${lessonStep}/5`}
            </p>
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-neutral-400 hover:bg-surface/60"
              data-testid="home-chat-teach-reset"
            >
              {languagePreference === 'sw' ? 'Mazungumzo mapya' : 'New thread'}
            </button>
          ) : null}
        </header>

        {showGreeting ? (
          <PersonaGreeting
            salutation={salutation}
            tradingName={tradingName}
            languagePreference={languagePreference}
            onSuggestion={onSuggestion}
            disabled={composerDisabled || isStreaming}
          />
        ) : null}

        <section
          className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface/40"
          aria-label="Borjie Teach transcript"
          data-testid="home-chat-teach-transcript"
        >
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <AskEmptyState
                kind={emptyKind}
                detail={emptyKind === 'error' ? lastError : null}
              />
            ) : (
              messages.map((message) => (
                <TeachBubble
                  key={message.id}
                  message={message}
                  languagePreference={languagePreference}
                  isLatestAssistant={message.id === lastAssistantId}
                  onSuggestion={onSuggestion}
                  onInlineAction={runInlineAction}
                  onUploadResults={reflectUploadResults}
                  composerDisabled={composerDisabled || isStreaming}
                  {...(onSpawnTab ? { onSpawnTab } : {})}
                />
              ))
            )}
            {isStreaming && !messages.some((m) => m.streaming) ? (
              <TypingBubble language={languagePreference} />
            ) : null}
            {errored && messages.length > 0 ? (
              <div
                role="alert"
                data-testid="home-chat-teach-error-inline"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {lastError ?? 'Stream errored.'}
              </div>
            ) : null}
          </div>

          {onSpawnTab ? (
            <div className="px-3 pb-2">
              <SuggestedTabBanner
                languagePreference={languagePreference}
                {...(banner.userMessage !== undefined && {
                  userMessage: banner.userMessage,
                })}
                {...(banner.brainReply !== undefined && {
                  brainReply: banner.brainReply,
                })}
                onSpawn={(descriptor) => {
                  const validDescriptor = getTab(descriptor.type);
                  if (!validDescriptor) return;
                  onSpawnTab({
                    type: descriptor.type,
                    context: {},
                    reason:
                      languagePreference === 'sw'
                        ? validDescriptor.descriptionSw
                        : validDescriptor.descriptionEn,
                  });
                }}
              />
            </div>
          ) : null}

          <ChatModeSurface
            state={chatModeState}
            language={languagePreference}
            onModeRevert={revertChatMode}
            onFollowUp={onSuggestion}
            disabled={composerDisabled || isStreaming}
          />

          <AskComposer
            busy={isStreaming}
            disabled={composerDisabled}
            voiceLocale={languagePreference}
            onSubmit={(content) => void send(content)}
          />
        </section>
        <BorjieDynamicHints
          language={languagePreference}
          affectiveProfile={affectiveProfile}
          masteryScore={masteryQuery.data ?? null}
          learnedShortcuts={shortcutsQuery.data ?? []}
          onHintAction={handleHintAction}
        />
      </div>
    </div>
  );
}

interface TeachBubbleProps {
  readonly message: TeachMessage;
  readonly languagePreference: 'sw' | 'en';
  readonly isLatestAssistant: boolean;
  readonly onSuggestion: (text: string) => void;
  /**
   * Execute an ACTION-bearing inline block through the gateway action-
   * bridge. The host owns the network dispatch + result reflection; this
   * component only forwards the raw `{ action, payload }` event.
   */
  readonly onInlineAction: (event: RawInlineActionEvent) => void;
  /**
   * Reflect the outcomes of a file_request_card upload into the transcript.
   * The card performs the real gateway upload; the host renders the notes.
   */
  readonly onUploadResults: (
    results: ReadonlyArray<DocUploadOutcome>,
  ) => void;
  readonly composerDisabled: boolean;
  readonly onSpawnTab?: (intent: OwnerOSSpawnIntent) => void;
}

function TeachBubble({
  message,
  languagePreference,
  isLatestAssistant,
  onSuggestion,
  onInlineAction,
  onUploadResults,
  composerDisabled,
  onSpawnTab,
}: TeachBubbleProps): ReactElement {
  const isOwner = message.role === 'user';
  const t = useMemo(
    () => makeT(dictionaries[languagePreference]),
    [languagePreference],
  );

  return (
    <div className="space-y-2">
      {!isOwner && message.inlineMetrics.length > 0 ? (
        <ul
          data-testid="teach-inline-metric-row"
          className="m-0 flex list-none flex-wrap gap-1.5 p-0 pl-10"
          aria-label="Live metrics"
        >
          {message.inlineMetrics.map((metric, i) => (
            <li key={`${metric.label}_${i}`}>
              <InlineMetricChip metric={metric} />
            </li>
          ))}
        </ul>
      ) : null}

      {!isOwner && (message.debate || message.brainState) ? (
        <div
          data-testid="teach-trust-badges"
          className="flex flex-wrap items-center gap-1.5 pl-10"
        >
          {message.debate ? (
            <span
              data-testid="teach-badge-verified"
              className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-tiny font-medium text-success"
            >
              <ShieldCheck aria-hidden="true" className="h-3 w-3" />
              {message.debate.verified
                ? t('teach.trustVerified', {
                    count: message.debate.contenders,
                  })
                : t('teach.trustDebate', {
                    count: message.debate.contenders,
                  })}
            </span>
          ) : null}
          {message.brainState ? (
            <span
              data-testid="teach-badge-degraded"
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-tiny font-medium text-warning"
            >
              <AlertTriangle aria-hidden="true" className="h-3 w-3" />
              {message.brainState.label}
            </span>
          ) : null}
        </div>
      ) : null}

      <MessageBubble
        role={message.role}
        createdAt={message.createdAt}
        errored={message.errored}
        streaming={message.streaming}
        testId={`teach-bubble-${message.role}`}
      >
        <p className="whitespace-pre-wrap">
          {message.text || (message.streaming ? '' : '(no content)')}
        </p>

        {!isOwner && message.uiBlock ? (
          <UiBlockRenderer
            block={message.uiBlock}
            language={languagePreference}
            onDeepDive={({ title, point }) => {
              const verb =
                languagePreference === 'sw' ? 'Nichunguzie' : 'Deep dive on';
              const target = point ? `"${point}"` : `"${title}"`;
              onSuggestion(`${verb} ${target}`);
            }}
            onGoWider={({ title, point }) => {
              const verb =
                languagePreference === 'sw' ? 'Panua kuhusu' : 'Go wider on';
              const target = point ? `"${point}"` : `"${title}"`;
              onSuggestion(`${verb} ${target}`);
            }}
            onRelatedClick={(concept) => {
              const verb =
                languagePreference === 'sw'
                  ? 'Nifundishe kuhusu'
                  : 'Teach me about';
              onSuggestion(`${verb} ${concept}`);
            }}
            onMicroLessonCta={onSuggestion}
            onDecisionOption={(_i, label) => {
              // Generative: route the chosen label as the next brain
              // turn — no hardcoded option-to-verb map. The brain that
              // emitted the decision_card receives the owner's choice
              // and fulfills the intent agentically.
              onSuggestion(label);
            }}
          />
        ) : null}

        {!isOwner && message.inlineBlocks.length > 0 ? (
          <ul
            data-testid="teach-inline-blocks"
            className="m-0 mt-3 flex list-none flex-col gap-2 p-0"
          >
            {message.inlineBlocks.map((block, i) => (
              <li
                key={`${block.type}_${i}`}
                data-testid={`teach-inline-block-${block.type}`}
                className="m-0 p-0"
              >
                <InlineBlockRenderer
                  block={block as unknown as Record<string, unknown> & {
                    type?: string;
                  }}
                  locale={languagePreference}
                  sessionId={message.id}
                  onAction={(event) => {
                    // Tab promotion. A STATIC registry tabType routes through
                    // onSpawnTab (dedup + augment in the owner-os shell). A
                    // DYNAMIC, brain-AUTHORED tabType is NOT in the static enum,
                    // so ownerOsSpawnBatchSchema.safeParse fails — rather than
                    // dropping the click (dead button), we DEFER it to the brain
                    // to GENERATE the dynamic tab: it builds the portal-genui tab
                    // via its tools and emits a genui proposal on the SSE stream,
                    // which the shell persists + opens in the background. This is
                    // the self-evolving path — any tab the brain invents promotes
                    // by construction, never gated on a static registry entry.
                    if (
                      event.action === 'spawn_tab' &&
                      event.payload &&
                      typeof event.payload === 'object'
                    ) {
                      const p = event.payload as {
                        readonly tabType?: string;
                        readonly context?: Record<string, unknown>;
                      };
                      const parsed = ownerOsSpawnBatchSchema.safeParse({
                        tabs: [
                          {
                            type: p.tabType,
                            context: p.context ?? {},
                            reason: 'Inline tab promotion',
                          },
                        ],
                      });
                      if (parsed.success && onSpawnTab) {
                        const first = parsed.data.tabs[0];
                        if (first) onSpawnTab(first);
                        return;
                      }
                      // Dynamic (non-static) tabType → defer to the brain.
                      if (typeof p.tabType === 'string' && p.tabType.length > 0) {
                        const ctx = p.context ?? {};
                        const label =
                          (typeof ctx['title'] === 'string' && ctx['title']) ||
                          (typeof ctx['label'] === 'string' && ctx['label']) ||
                          p.tabType.replace(/[._:-]+/g, ' ').trim();
                        onSuggestion(t('teach.microAction.promoteTab', { label }));
                      }
                      return;
                    }
                    // file_request_card upload → the card already streamed
                    // the bytes to the gateway; reflect each outcome into the
                    // transcript (success with extracted-field count, or a
                    // graceful failure note). Unknown shapes fall back to the
                    // text suggestion inside the reflector.
                    if (event.action === 'upload') {
                      const p = event.payload as {
                        readonly results?: ReadonlyArray<DocUploadOutcome>;
                      };
                      onUploadResults(
                        Array.isArray(p.results) ? p.results : [],
                      );
                      return;
                    }
                    // level_select → reply as the owner's next turn so
                    // the brain calibrates subsequent responses.
                    if (event.action === 'level_select') {
                      const p = event.payload as {
                        readonly levelId?: string;
                        readonly label?: string;
                      };
                      if (typeof p.label === 'string' && p.label.length > 0) {
                        onSuggestion(p.label);
                      }
                      return;
                    }
                    // ACTION-bearing blocks (micro_action_card,
                    // confirmation_card primary, data_capture submit) →
                    // EXECUTE through the gateway action-bridge. The host
                    // maps the verb/params, dispatches, and reflects the
                    // result; blocks with no executable verb (file upload,
                    // cancel, unknown) fall back to a text suggestion so
                    // the brain still responds.
                    if (typeof event.action === 'string' && event.action.length > 0) {
                      onInlineAction(event);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {!isOwner && message.citations.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid="teach-citations"
          >
            {message.citations.map((id) => (
              <span
                key={id}
                className="rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-tiny font-medium text-info"
              >
                {id.replace(/^borjie:/, '')}
              </span>
            ))}
          </div>
        ) : null}

        {!isOwner && message.errored && message.errorMessage ? (
          <p className="mt-2 text-tiny text-destructive">
            {message.errorMessage}
          </p>
        ) : null}

        {!isOwner &&
        !message.streaming &&
        !message.errored &&
        message.text.trim().length > 0 ? (
          <div className="mt-2 flex" data-testid="teach-voice-playback">
            <VoicePlayButton
              text={message.text}
              languagePreference={languagePreference}
            />
          </div>
        ) : null}
      </MessageBubble>

      {!isOwner && message.autoAuthorized ? (
        <div
          data-testid="teach-auto-authorized"
          className="ml-10 flex max-w-2xl items-start gap-2 rounded-xl border border-info/30 bg-info/5 px-3 py-2"
        >
          <Zap
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info"
          />
          <div className="flex flex-col gap-0.5">
            <p className="text-tiny font-semibold uppercase tracking-wide text-info">
              {t('teach.autoAuthorized')}
              {' · '}
              {message.autoAuthorized.action}
            </p>
            {message.autoAuthorized.rationale ? (
              <p className="text-tiny text-neutral-300">
                {message.autoAuthorized.rationale}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {!isOwner && isLatestAssistant && message.suggestedActions.length > 0 ? (
        <QuickReplyChips
          replies={message.suggestedActions.map((action) => ({ value: action }))}
          language={languagePreference}
          onSelect={onSuggestion}
          disabled={composerDisabled}
          eyebrow={languagePreference === 'sw' ? 'Hatua zinazofuata' : 'Next moves'}
        />
      ) : null}

      {!isOwner && message.spawnTabs.length > 0 && onSpawnTab ? (
        <div
          data-testid="teach-spawn-tabs"
          className="ml-10 flex max-w-2xl flex-col gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2"
        >
          <p className="text-tiny uppercase tracking-wide text-warning">
            {languagePreference === 'sw'
              ? 'Tabs zinazopendekezwa'
              : 'Suggested tabs'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {message.spawnTabs.map((intent, i) => (
              <button
                key={`${intent.type}_${i}`}
                type="button"
                onClick={() => onSpawnTab(intent)}
                data-testid={`teach-spawn-${intent.type}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-tiny font-medium text-warning hover:bg-warning/20"
              >
                <Plus aria-hidden="true" className="h-3 w-3" />
                <span>{intent.type}</span>
                <span className="text-neutral-400">·</span>
                <span className="truncate max-w-xs text-neutral-300">
                  {intent.reason}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!isOwner ? (
        <SuperpowerChips
          languagePreference={languagePreference}
          navigates={message.navigates}
          prefills={message.prefills}
          highlights={message.highlights}
          shares={message.shares}
          bulks={message.bulks}
          bookmarks={message.bookmarks}
        />
      ) : null}

      {!isOwner && message.handoffs.length > 0 ? (
        <div
          data-testid="teach-handoff-cards"
          className="ml-10 flex max-w-2xl flex-col gap-2"
        >
          {message.handoffs.map((handoff) => (
            <HandoffCard
              key={handoff.id}
              handoff={handoff}
              language={languagePreference}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
