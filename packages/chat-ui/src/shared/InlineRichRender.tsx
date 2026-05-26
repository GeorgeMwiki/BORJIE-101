/**
 * InlineRichRender — shared inline-renderer used by BOTH home chat (the
 * full-screen Mr. Mwikila tab) and the floating chat widget bubble.
 *
 * Founder directive: floating chat must render tab-detail + blackboard
 * payloads inline in the message stream, exactly the same way home chat
 * does. Prior to this component the wiring lived only on the home
 * surface, so a message that carried a tab-detail / dashboard / blackboard
 * payload would degrade to plain markdown text inside the widget.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Responsibilities
 * ──────────────────────────────────────────────────────────────────────
 *
 *   1.  Extract well-formed payloads from `ChatMessage.metadata`:
 *       - `uiBlocks`     — chat-ui native blocks (rent calculator, quiz, …)
 *       - `uiParts`      — `@borjie/genui` AG-UI primitives (chart, kanban,
 *                          heatmap, markdown-card, diff-view, calendar, …)
 *       - `blackboard`   — `{ conceptTitle?, parts?: AgUiUiPart[] }`
 *                          payload emitted when a blackboard event fires
 *                          (matches the home-shell Blackboard slot shape).
 *       - `tabDetail`    — `{ title?, parts?: AgUiUiPart[] }` payload
 *                          emitted when the assistant references a tab /
 *                          dashboard / document and wants the detail
 *                          embedded inline.
 *
 *   2.  Dispatch each payload to its existing renderer (chat-ui
 *       AdaptiveRenderer for `uiBlocks`, @borjie/genui AdaptiveRenderer
 *       for `uiParts`). NO new renderer logic lives here — this is a
 *       parity/extraction layer ONLY.
 *
 *   3.  Forward a `variant` ('expanded' | 'compact') so the floating
 *       widget can pass `compact` to keep embeds inside the 380px panel.
 *
 *   4.  Defensive parsing — every metadata field is treated as `unknown`
 *       and shape-checked before rendering, so a malformed payload never
 *       crashes the chat.
 *
 * Adding a NEW shared payload type? Add a `pickXxx` extractor + a render
 * branch below, then both chat surfaces inherit the embed automatically.
 */

import type { CSSProperties, ReactNode } from 'react';

import {
  AdaptiveRenderer as GenUiAdaptiveRenderer,
  type AgUiUiPart,
} from '@borjie/genui';

import type { Language, Translator } from '../chat-modes/types';
import { AdaptiveRenderer as ChatUiAdaptiveRenderer } from '../generative-ui/AdaptiveRenderer';
import type {
  AdaptiveMessageMetadata,
  UIBlock,
} from '../generative-ui/types';

/**
 * Compact = floating chat widget (380×560). Expanded = home chat full
 * screen. Compact shrinks max width + tightens padding; the actual rich
 * embeds (charts, tables) still own their own internal scaling.
 */
export type InlineRichRenderVariant = 'expanded' | 'compact';

export interface InlineBlackboardPayload {
  readonly conceptTitle?: string;
  readonly parts?: ReadonlyArray<AgUiUiPart>;
}

export interface InlineTabDetailPayload {
  readonly title?: string;
  readonly subtitle?: string;
  readonly parts?: ReadonlyArray<AgUiUiPart>;
}

export interface InlineRichRenderProps {
  /**
   * Raw message metadata as it appears on `ChatMessage.metadata`.
   * Treated as `unknown` and shape-checked field-by-field.
   */
  readonly metadata?: Record<string, unknown> | undefined;
  readonly language: Language;
  readonly t?: Translator;
  readonly variant?: InlineRichRenderVariant;
  readonly onSendMessage?: (msg: string) => void;
  readonly onQuizAnswer?: (
    blockId: string,
    optionId: string,
    correct: boolean,
  ) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Shape extraction — every entry point is `unknown` then narrows.
// ─────────────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Pick `uiBlocks` (chat-ui native blocks). Returns `null` when missing
 * or malformed; the caller short-circuits the render branch.
 */
function pickUiBlocks(meta: Record<string, unknown>): readonly UIBlock[] | null {
  const raw = meta['uiBlocks'];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  // Best-effort shape check: every entry must be an object with a
  // string `type` and `id`. The chat-ui AdaptiveRenderer + each block's
  // own renderer do the deep shape-check; we only ensure we are not
  // handing it pure garbage.
  const ok = raw.every(
    (entry) =>
      isObject(entry) &&
      typeof entry['type'] === 'string' &&
      typeof entry['id'] === 'string',
  );
  if (!ok) return null;
  return raw as readonly UIBlock[];
}

/**
 * Pick a `uiParts` array (`@borjie/genui` AG-UI primitives). Each entry
 * must carry a string `kind` — the genui AdaptiveRenderer does the deep
 * schema validation and gracefully degrades unknown kinds.
 */
function pickUiParts(meta: Record<string, unknown>): readonly AgUiUiPart[] | null {
  const raw = meta['uiParts'];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ok = raw.every(
    (entry) => isObject(entry) && typeof entry['kind'] === 'string',
  );
  if (!ok) return null;
  return raw as readonly AgUiUiPart[];
}

function pickBlackboard(
  meta: Record<string, unknown>,
): InlineBlackboardPayload | null {
  const raw = meta['blackboard'];
  if (!isObject(raw)) return null;
  const parts = pickUiPartArrayField(raw, 'parts');
  const conceptTitleRaw = raw['conceptTitle'];
  const conceptTitle =
    typeof conceptTitleRaw === 'string' ? conceptTitleRaw : undefined;
  if (!parts && !conceptTitle) return null;
  return {
    ...(conceptTitle !== undefined ? { conceptTitle } : {}),
    ...(parts ? { parts } : {}),
  };
}

function pickTabDetail(
  meta: Record<string, unknown>,
): InlineTabDetailPayload | null {
  const raw = meta['tabDetail'];
  if (!isObject(raw)) return null;
  const parts = pickUiPartArrayField(raw, 'parts');
  if (!parts) return null;
  const titleRaw = raw['title'];
  const subtitleRaw = raw['subtitle'];
  const title = typeof titleRaw === 'string' ? titleRaw : undefined;
  const subtitle = typeof subtitleRaw === 'string' ? subtitleRaw : undefined;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    parts,
  };
}

function pickUiPartArrayField(
  obj: Record<string, unknown>,
  field: string,
): readonly AgUiUiPart[] | null {
  const raw = obj[field];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ok = raw.every(
    (entry) => isObject(entry) && typeof entry['kind'] === 'string',
  );
  if (!ok) return null;
  return raw as readonly AgUiUiPart[];
}

/**
 * True when the metadata carries ANY shape this renderer knows how to
 * embed inline. Hosts can use this to decide whether to render the
 * <InlineRichRender> at all (e.g. to avoid an empty wrapper div).
 */
export function hasInlineRichContent(
  metadata?: Record<string, unknown> | undefined,
): boolean {
  if (!isObject(metadata)) return false;
  return (
    pickUiBlocks(metadata) !== null ||
    pickUiParts(metadata) !== null ||
    pickBlackboard(metadata) !== null ||
    pickTabDetail(metadata) !== null
  );
}

// ─────────────────────────────────────────────────────────────────────
// Layout — minimal inline styles so the component works in every host
// (Vite SPA, Next.js, jsdom test) without depending on a CSS layer.
// ─────────────────────────────────────────────────────────────────────

function containerStyle(variant: InlineRichRenderVariant): CSSProperties {
  if (variant === 'compact') {
    return {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      marginTop: 6,
      // Floating chat panel is 380px wide; lock max-width slightly
      // smaller so embedded charts and tables can breathe inside the
      // bubble padding without horizontal overflow.
      maxWidth: '100%',
      width: '100%',
      fontSize: 12,
    };
  }
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginTop: 8,
    width: '100%',
  };
}

function sectionCardStyle(variant: InlineRichRenderVariant): CSSProperties {
  return {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: variant === 'compact' ? 10 : 12,
    padding: variant === 'compact' ? 10 : 14,
    display: 'flex',
    flexDirection: 'column',
    gap: variant === 'compact' ? 6 : 10,
  };
}

function blackboardCardStyle(variant: InlineRichRenderVariant): CSSProperties {
  return {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: variant === 'compact' ? 10 : 14,
    padding: variant === 'compact' ? 10 : 14,
    color: '#f1f5f9',
    display: 'flex',
    flexDirection: 'column',
    gap: variant === 'compact' ? 6 : 10,
  };
}

function blackboardCanvasStyle(variant: InlineRichRenderVariant): CSSProperties {
  return {
    background: '#f8fafc',
    color: '#0f172a',
    borderRadius: variant === 'compact' ? 8 : 10,
    padding: variant === 'compact' ? 8 : 12,
    display: 'flex',
    flexDirection: 'column',
    gap: variant === 'compact' ? 6 : 10,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Render branches
// ─────────────────────────────────────────────────────────────────────

function renderUiParts(parts: readonly AgUiUiPart[]): ReactNode {
  return parts.map((part, idx) => (
    <GenUiAdaptiveRenderer key={`uipart-${idx}`} uiPart={part} />
  ));
}

function renderTabDetail(
  payload: InlineTabDetailPayload,
  variant: InlineRichRenderVariant,
): ReactNode {
  return (
    <section
      data-testid="inline-tab-detail"
      data-variant={variant}
      style={sectionCardStyle(variant)}
    >
      {payload.title ? (
        <header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong
            data-testid="inline-tab-detail-title"
            style={{ fontSize: variant === 'compact' ? 12 : 14, color: '#0f172a' }}
          >
            {payload.title}
          </strong>
          {payload.subtitle ? (
            <span
              data-testid="inline-tab-detail-subtitle"
              style={{
                fontSize: variant === 'compact' ? 10 : 12,
                color: '#64748b',
              }}
            >
              {payload.subtitle}
            </span>
          ) : null}
        </header>
      ) : null}
      {payload.parts ? renderUiParts(payload.parts) : null}
    </section>
  );
}

function renderBlackboard(
  payload: InlineBlackboardPayload,
  variant: InlineRichRenderVariant,
): ReactNode {
  return (
    <section
      data-testid="inline-blackboard"
      data-variant={variant}
      aria-label="Blackboard"
      style={blackboardCardStyle(variant)}
    >
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Blackboard
        </span>
        {payload.conceptTitle ? (
          <strong
            data-testid="inline-blackboard-concept"
            style={{ fontSize: variant === 'compact' ? 12 : 15 }}
          >
            {payload.conceptTitle}
          </strong>
        ) : null}
      </header>
      {payload.parts && payload.parts.length > 0 ? (
        <div style={blackboardCanvasStyle(variant)}>
          {renderUiParts(payload.parts)}
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

/**
 * Renders any rich-content payloads carried on a chat message's
 * metadata. Returns `null` when there is nothing to show — callers can
 * mount this unconditionally next to every bubble.
 */
export function InlineRichRender({
  metadata,
  language,
  t,
  variant = 'expanded',
  onSendMessage,
  onQuizAnswer,
}: InlineRichRenderProps): JSX.Element | null {
  if (!isObject(metadata)) return null;

  const uiBlocks = pickUiBlocks(metadata);
  const uiParts = pickUiParts(metadata);
  const blackboard = pickBlackboard(metadata);
  const tabDetail = pickTabDetail(metadata);

  if (!uiBlocks && !uiParts && !blackboard && !tabDetail) {
    return null;
  }

  // Build the AdaptiveMessageMetadata only when we actually have blocks
  // to render — keeps the chat-ui AdaptiveRenderer from short-circuiting
  // on its `blocks.length === 0` guard.
  const chatUiMeta: AdaptiveMessageMetadata | undefined = uiBlocks
    ? { uiBlocks }
    : undefined;

  return (
    <div
      data-testid="inline-rich-render"
      data-variant={variant}
      style={containerStyle(variant)}
    >
      {chatUiMeta ? (
        <ChatUiAdaptiveRenderer
          metadata={chatUiMeta}
          language={language}
          {...(t ? { t } : {})}
          {...(onSendMessage ? { onSendMessage } : {})}
          {...(onQuizAnswer ? { onQuizAnswer } : {})}
        />
      ) : null}
      {tabDetail ? renderTabDetail(tabDetail, variant) : null}
      {blackboard ? renderBlackboard(blackboard, variant) : null}
      {uiParts && uiParts.length > 0 ? (
        <div
          data-testid="inline-rich-render-uiparts"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {renderUiParts(uiParts)}
        </div>
      ) : null}
    </div>
  );
}
