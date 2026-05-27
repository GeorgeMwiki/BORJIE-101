'use client';

/**
 * CalendarInner — the FullCalendar slice. Loaded behind ClientOnly +
 * React.lazy in the parent so the bundle stays out of SSR.
 *
 * Hardening (Wave 15E): FullCalendar + its plugins are loaded via
 * dynamic `import()` inside `useEffect` rather than via top-level
 * `import` statements. When this package is bundled with tsup
 * `splitting: false`, top-level imports collapse into the dist
 * barrel and FullCalendar's DOM probes can crash SSR. Loading after
 * mount keeps SSR safe even if the bundler eagerly inlines this
 * module.
 */

import { useEffect, useState, type ComponentType } from 'react';
import type { CalendarEvent } from '../types';

interface FullCalendarEventInput {
  readonly id?: string | undefined;
  readonly title: string;
  readonly start: string;
  readonly end?: string | undefined;
  readonly color?: string | undefined;
}
interface FullCalendarProps {
  readonly plugins: ReadonlyArray<unknown>;
  readonly initialView?: string | undefined;
  readonly events: ReadonlyArray<FullCalendarEventInput>;
  readonly height?: 'auto' | number | string | undefined;
}

interface FullCalendarBundle {
  readonly FullCalendar: ComponentType<FullCalendarProps>;
  readonly dayGridPlugin: unknown;
  readonly timeGridPlugin: unknown;
}

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
  const [bundle, setBundle] = useState<FullCalendarBundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [fcMod, dayMod, timeMod] = await Promise.all([
          // @ts-ignore — peer dep of the consuming app
          import('@fullcalendar/react'),
          // @ts-ignore — peer dep of the consuming app
          import('@fullcalendar/daygrid'),
          // @ts-ignore — peer dep of the consuming app
          import('@fullcalendar/timegrid'),
        ]);
        if (cancelled) return;
        // Cast through `unknown` because the real `@fullcalendar/react`
        // typings (CalendarOptions) collide with our local minimal
        // `FullCalendarProps` shape — peer dep is loose by design.
        setBundle({
          FullCalendar: (fcMod as unknown as { default: ComponentType<FullCalendarProps> })
            .default,
          dayGridPlugin: (dayMod as unknown as { default: unknown }).default,
          timeGridPlugin: (timeMod as unknown as { default: unknown }).default,
        });
      } catch {
        /* peer dep missing — render fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bundle) {
    return <span className="text-xs text-muted-foreground">loading calendar…</span>;
  }

  const { FullCalendar, dayGridPlugin, timeGridPlugin } = bundle;

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
