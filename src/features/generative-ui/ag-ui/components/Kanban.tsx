"use client";

/**
 * 11. kanban — swimlane columns + cards.
 *
 * No-dep static board with horizontal scroll. Cards are draggable
 * visually via cursor styling but reordering is the consumer's job
 * (a tool round-trip — drag-drop is NOT modeled in the UiPart payload
 * because the LLM emits read-only state per turn).
 *
 * Anti-pattern guards:
 *   - LLM never emits classnames or layout
 *   - safeParse before render
 */

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { KanbanPartSchema } from "../schemas";
import { formatDate } from "../format";

export type KanbanProps = AgUiUiPartByKind<"kanban">;

export function Kanban(props: KanbanProps): JSX.Element {
  const parsed = KanbanPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="kanban"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="kanban" {...(props.title ? { title: props.title } : {})}>
      <div className="flex gap-2 overflow-x-auto">
        {props.columns.map((col) => (
          <div
            key={col.id}
            className="min-w-[220px] flex-1 rounded-md border border-border bg-surface-sunken p-2"
            data-kanban-column={col.id}
          >
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {col.title}
              </h4>
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {col.cards.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {col.cards.map((card) => (
                <article
                  key={card.id}
                  className="cursor-grab rounded border border-border bg-surface p-2 text-xs"
                  data-kanban-card={card.id}
                >
                  <div className="font-medium text-foreground">
                    {card.title}
                  </div>
                  {card.subtitle ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {card.subtitle}
                    </div>
                  ) : null}
                  {card.badges && card.badges.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {card.badges.map((b, i) => (
                        <span
                          key={i}
                          className="rounded bg-surface-sunken px-1 py-0.5 text-[10px] text-foreground"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {card.dueAt ? (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      due {formatDate(card.dueAt)}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}
