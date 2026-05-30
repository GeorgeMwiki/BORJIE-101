'use client';

/**
 * InlineLearningBlocks — narrow port of LitFin's chat-message-level
 * generative-UI pattern. Renders `concept_card` and `ui_block` payloads
 * inline within an AI message bubble (NOT the stepper / classroom /
 * adaptive-layout framework — those are lending-app-specific).
 *
 * Source pattern this mirrors (chat-message level only):
 *   LITFIN_PATH/src/core/litfin-ai/components/AIMessageText.tsx
 *   LITFIN_PATH/src/core/litfin-ai/components/MessageBubble.tsx (block-rendering subset)
 *   LITFIN_PATH/src/core/litfin-ai/generative-ui/blocks/ConceptCard.tsx (shape only)
 *
 * Block shapes accepted by this renderer:
 *   { type: 'concept_card', title, summary, keyPoints?, citation? }
 *   { type: 'ui_block', kind, payload }
 *
 * For `ui_block`, two well-known kinds are wired:
 *   - 'royalty_calculator' (Borjie mining) → simple inline calculator stub
 *   - 'rent_reminder_schedule' (BN real-estate) → schedule preview
 * Unknown kinds fall through to a JSON dump card so the AI can still
 * emit experimental blocks without crashing the widget.
 */

import type { JSX } from 'react';

// ─── Block shapes ──────────────────────────────────────────────────

export interface ConceptCardChatBlock {
  readonly type: 'concept_card';
  readonly title: string;
  readonly summary: string;
  readonly keyPoints?: ReadonlyArray<string>;
  readonly citation?: string;
}

export interface UiChatBlock {
  readonly type: 'ui_block';
  readonly kind: string;
  readonly payload?: Record<string, unknown>;
}

export type InlineChatBlock = ConceptCardChatBlock | UiChatBlock;

// ─── Renderers ────────────────────────────────────────────────────

function ConceptCardInline({
  block,
}: {
  readonly block: ConceptCardChatBlock;
}): JSX.Element {
  const points = block.keyPoints ?? [];
  return (
    <div
      data-testid="chat-inline-concept-card"
      className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 shadow-sm"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
          C
        </span>
        <h3 className="text-sm font-semibold text-foreground">{block.title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-foreground/85">
        {block.summary}
      </p>
      {points.length > 0 && (
        <ul className="mt-2 space-y-1">
          {points.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[13px] text-foreground/80"
            >
              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-primary/60" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {block.citation && (
        <p className="mt-2 border-t border-primary/15 pt-2 text-[11px] italic text-muted-foreground">
          {block.citation}
        </p>
      )}
    </div>
  );
}

interface RoyaltyPayload {
  readonly mineral?: string;
  readonly rate?: number;
  readonly grossSales?: number;
  readonly currency?: string;
}

function RoyaltyCalculatorInline({
  payload,
}: {
  readonly payload: RoyaltyPayload;
}): JSX.Element {
  const rate = typeof payload.rate === 'number' ? payload.rate : 0;
  const gross = typeof payload.grossSales === 'number' ? payload.grossSales : 0;
  const royalty = (gross * rate) / 100;
  const currency = payload.currency ?? 'TZS';
  const fmt = (n: number): string =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <div
      data-testid="chat-inline-royalty-calc"
      className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
    >
      <h3 className="text-sm font-semibold text-foreground">
        Royalty estimate{payload.mineral ? ` — ${payload.mineral}` : ''}
      </h3>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
        <div className="rounded border border-border bg-background/40 p-2">
          <p className="text-muted-foreground">Rate</p>
          <p className="font-mono text-foreground">{rate}%</p>
        </div>
        <div className="rounded border border-border bg-background/40 p-2">
          <p className="text-muted-foreground">Gross sales</p>
          <p className="font-mono text-foreground">
            {currency} {fmt(gross)}
          </p>
        </div>
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="text-amber-700 dark:text-amber-300">Royalty due</p>
          <p className="font-mono font-semibold text-amber-800 dark:text-amber-200">
            {currency} {fmt(royalty)}
          </p>
        </div>
      </div>
    </div>
  );
}

interface RentReminderPayload {
  readonly unitLabel?: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly daysBefore?: ReadonlyArray<number>;
}

function RentReminderInline({
  payload,
}: {
  readonly payload: RentReminderPayload;
}): JSX.Element {
  const days = payload.daysBefore ?? [7, 3, 1];
  const currency = payload.currency ?? 'TZS';
  const fmt = (n: number): string =>
    n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return (
    <div
      data-testid="chat-inline-rent-reminder"
      className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3"
    >
      <h3 className="text-sm font-semibold text-foreground">
        Rent reminder schedule
        {payload.unitLabel ? ` — ${payload.unitLabel}` : ''}
      </h3>
      {typeof payload.amount === 'number' && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Amount: {currency} {fmt(payload.amount)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {days.map((d, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
          >
            {d === 1 ? '1 day before' : `${d} days before`}
          </span>
        ))}
      </div>
    </div>
  );
}

function UnknownBlockInline({
  block,
}: {
  readonly block: UiChatBlock;
}): JSX.Element {
  return (
    <div
      data-testid="chat-inline-unknown-block"
      className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-[11px]"
    >
      <p className="font-semibold text-muted-foreground">
        ui_block ({block.kind})
      </p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground/80">
        {JSON.stringify(block.payload ?? {}, null, 2)}
      </pre>
    </div>
  );
}

// ─── Public renderer ──────────────────────────────────────────────

export interface InlineLearningBlocksProps {
  readonly blocks: ReadonlyArray<InlineChatBlock>;
}

export function InlineLearningBlocks({
  blocks,
}: InlineLearningBlocksProps): JSX.Element | null {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'concept_card') {
          return <ConceptCardInline key={i} block={block} />;
        }
        if (block.type === 'ui_block') {
          const payload =
            (block.payload as Record<string, unknown> | undefined) ?? {};
          if (block.kind === 'royalty_calculator') {
            return (
              <RoyaltyCalculatorInline
                key={i}
                payload={payload as RoyaltyPayload}
              />
            );
          }
          if (block.kind === 'rent_reminder_schedule') {
            return (
              <RentReminderInline
                key={i}
                payload={payload as RentReminderPayload}
              />
            );
          }
          return <UnknownBlockInline key={i} block={block} />;
        }
        return null;
      })}
    </div>
  );
}
