"use client";

/**
 * projection-tabs — the central-command MD projection-tab registry.
 *
 * The MD cockpit's read-only projection surfaces (Employees, Tasks,
 * KPIs, Meeting Notes, Escalations) each ship a lazy-loaded
 * `*TabContent` component, but until SLICE B1 there was NO registry
 * assembling them — every `*TabContent` had zero importers and was
 * therefore unreachable (finding M7). This module is that registry: a
 * single typed map of `{ id → { label(en/sw), lazy component } }` the
 * cockpit shell renders as tabs.
 *
 * Components are `React.lazy`-imported so each projection's Supabase /
 * gateway code only loads when its tab is opened. Labels carry complete
 * en + sw strings (single language per render — the shell selects one).
 *
 * @module features/central-command/md/projection-tabs
 */

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type ProjectionTabId =
  | "employees"
  | "tasks"
  | "kpis"
  | "meeting-notes"
  | "escalations";

export interface ProjectionTabLabel {
  readonly en: string;
  readonly sw: string;
}

export interface ProjectionTabDef {
  readonly id: ProjectionTabId;
  readonly label: ProjectionTabLabel;
  /** Lazy component; default-exported, no required props. */
  readonly component: LazyExoticComponent<ComponentType>;
  /** Lower sorts earlier in the tab strip. */
  readonly order: number;
}

const employeesTab: ProjectionTabDef = {
  id: "employees",
  label: { en: "Team", sw: "Timu" },
  component: lazy(() => import("./employees/ui/EmployeesTabContent")),
  order: 10,
};

const tasksTab: ProjectionTabDef = {
  id: "tasks",
  label: { en: "Tasks", sw: "Kazi" },
  component: lazy(() => import("./tasks/ui/TasksTabContent")),
  order: 20,
};

const kpisTab: ProjectionTabDef = {
  id: "kpis",
  label: { en: "KPIs", sw: "Viashiria" },
  component: lazy(() => import("./kpis/ui/KpisTabContent")),
  order: 30,
};

const meetingNotesTab: ProjectionTabDef = {
  id: "meeting-notes",
  label: { en: "Meeting Notes", sw: "Kumbukumbu za Mkutano" },
  component: lazy(() => import("./meeting-notes/ui/MeetingNotesTabContent")),
  order: 40,
};

const escalationsTab: ProjectionTabDef = {
  id: "escalations",
  label: { en: "Escalations", sw: "Taarifa za Dharura" },
  component: lazy(() => import("./escalations/ui/EscalationsTabContent")),
  order: 50,
};

/** Registry as an immutable, order-sorted list. */
export const PROJECTION_TABS: ReadonlyArray<ProjectionTabDef> = Object.freeze([
  employeesTab,
  tasksTab,
  kpisTab,
  meetingNotesTab,
  escalationsTab,
]
  .slice()
  .sort((a, b) => a.order - b.order));

export function findProjectionTab(
  id: ProjectionTabId,
): ProjectionTabDef | undefined {
  return PROJECTION_TABS.find((t) => t.id === id);
}
