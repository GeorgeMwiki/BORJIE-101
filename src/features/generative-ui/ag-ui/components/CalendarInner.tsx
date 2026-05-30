"use client";

/**
 * CalendarInner — the FullCalendar slice. Loaded behind ClientOnly +
 * React.lazy in the parent so the bundle stays out of SSR.
 */

// @ts-ignore — module is a peer dep of the consuming app
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
import FullCalendarMod from "@fullcalendar/react";
// @ts-ignore — module is a peer dep of the consuming app
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
import dayGridPlugin from "@fullcalendar/daygrid";
// @ts-ignore — module is a peer dep of the consuming app
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
import timeGridPlugin from "@fullcalendar/timegrid";

import type { CalendarEvent } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
const FullCalendar = FullCalendarMod as any;

export interface CalendarInnerProps {
  readonly events: ReadonlyArray<CalendarEvent>;
  readonly view: "dayGrid" | "timeGrid" | "list";
}

const VIEW_NAME: Record<string, string> = {
  dayGrid: "dayGridMonth",
  timeGrid: "timeGridWeek",
  list: "listWeek",
};

export function CalendarInner(props: CalendarInnerProps): JSX.Element {
  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin]}
      initialView={VIEW_NAME[props.view]}
      events={props.events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        color: e.color,
      }))}
      height="auto"
    />
  );
}
