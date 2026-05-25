'use client';

/**
 * CalendarInner — the FullCalendar slice. Loaded behind ClientOnly +
 * React.lazy in the parent so the bundle stays out of SSR.
 */

// @ts-ignore — module is a peer dep of the consuming app
import FullCalendarMod from '@fullcalendar/react';
// @ts-ignore — module is a peer dep of the consuming app
import dayGridPlugin from '@fullcalendar/daygrid';
// @ts-ignore — module is a peer dep of the consuming app
import timeGridPlugin from '@fullcalendar/timegrid';

import type { ComponentType } from 'react';
import type { CalendarEvent } from '../types';

interface FullCalendarEventInput {
  readonly id?: string;
  readonly title: string;
  readonly start: string;
  readonly end?: string;
  readonly color?: string;
}
interface FullCalendarProps {
  readonly plugins: ReadonlyArray<unknown>;
  readonly initialView?: string;
  readonly events: ReadonlyArray<FullCalendarEventInput>;
  readonly height?: 'auto' | number | string;
}

const FullCalendar = FullCalendarMod as unknown as ComponentType<FullCalendarProps>;

export interface CalendarInnerProps {
  readonly events: ReadonlyArray<CalendarEvent>;
  readonly view: 'dayGrid' | 'timeGrid' | 'list';
}

const VIEW_NAME: Record<string, string> = {
  dayGrid: 'dayGridMonth',
  timeGrid: 'timeGridWeek',
  list: 'listWeek',
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
