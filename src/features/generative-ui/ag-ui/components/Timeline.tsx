"use client";

/**
 * 3. timeline — vertical event timeline.
 *
 * shadcn vertical-timeline pattern, no external deps. Renders
 * chronological events grouped by severity colour.
 */

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { TimelinePartSchema } from "../schemas";
import { formatDate } from "../format";

export type TimelineProps = AgUiUiPartByKind<"timeline">;

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-blue-500",
  warn: "bg-yellow-500",
  error: "bg-red-500",
  success: "bg-green-500",
};

export function Timeline(props: TimelineProps): JSX.Element {
  const parsed = TimelinePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="timeline"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  const sorted = [...props.events].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );

  return (
    <Frame kind="timeline" {...(props.title ? { title: props.title } : {})}>
      <ol className="relative border-l border-border ml-2">
        {sorted.map((e, i) => {
          const colour =
            SEVERITY_DOT[e.severity ?? "info"] ?? SEVERITY_DOT.info;
          return (
            <li key={i} className="ml-4 mb-3">
              <span
                aria-hidden
                className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-background ${colour}`}
              />
              <time className="block text-[11px] text-muted-foreground">
                {formatDate(e.timestamp)}
              </time>
              <h4 className="text-sm font-medium text-foreground">{e.title}</h4>
              {e.description ? (
                <p className="text-xs text-muted-foreground">{e.description}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}
