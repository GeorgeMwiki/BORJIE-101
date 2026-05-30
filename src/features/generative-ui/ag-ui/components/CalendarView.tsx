"use client";

/**
 * 9. calendar — FullCalendar v6 inline.
 *
 * Dependencies (peer-dep on the consuming app):
 *   - @fullcalendar/react ^6.1.15
 *   - @fullcalendar/daygrid ^6.1.15
 *   - @fullcalendar/timegrid ^6.1.15
 *
 * The package targets both Next.js and Vite, so we use `React.lazy` +
 * `ClientOnly` mount guard instead of `next/dynamic`.
 */

import { lazy, Suspense } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ClientOnly } from "./ClientOnly";
import { CalendarPartSchema } from "../schemas";

export type CalendarViewProps = AgUiUiPartByKind<"calendar">;

const CalendarInner = lazy(async () => {
  const m = await import("./CalendarInner");
  return { default: m.CalendarInner };
});

export function CalendarView(props: CalendarViewProps): JSX.Element {
  const parsed = CalendarPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="calendar"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="calendar" {...(props.title ? { title: props.title } : {})}>
      <ClientOnly
        fallback={
          <span className="text-xs text-muted-foreground">
            loading calendar…
          </span>
        }
      >
        <Suspense
          fallback={
            <span className="text-xs text-muted-foreground">
              loading calendar…
            </span>
          }
        >
          <CalendarInner events={props.events} view={props.view ?? "dayGrid"} />
        </Suspense>
      </ClientOnly>
    </Frame>
  );
}
