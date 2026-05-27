/**
 * Brain tool-name → home-card routing table.
 *
 * Kept side-effect-free (no react-native imports) so the chat surface
 * tests and any downstream consumers (analytics, audit-trail) can read
 * the routing without dragging the renderer's dependency graph in.
 *
 * Adding a new tool means: (a) extend `TOOL_CARD_ROUTING`, (b) handle
 * the new tool in `ToolCallRenderer.renderKnown`, (c) update the
 * home-chat tests.
 */

export type ToolName =
  | 'cockpit.daily-brief'
  | 'cockpit.decisions'
  | 'cockpit.production'
  | 'attendance.crew'
  | 'incidents.exceptions'
  | 'tasks.today'
  | 'attendance.shift'
  | 'performance.snapshot'

export const TOOL_CARD_ROUTING: Readonly<
  Record<ToolName, { readonly sw: string; readonly en: string }>
> = Object.freeze({
  'cockpit.daily-brief': { sw: 'Muhtasari wa leo', en: 'Daily brief' },
  'cockpit.decisions': { sw: 'Maamuzi yanayosubiri', en: 'Pending decisions' },
  'cockpit.production': { sw: 'Uzalishaji', en: 'Production' },
  'attendance.crew': { sw: 'Hali ya timu', en: 'Crew status' },
  'incidents.exceptions': { sw: 'Vikwazo vya sasa', en: 'Live exceptions' },
  'tasks.today': { sw: 'Kazi za leo', en: "Today's tasks" },
  'attendance.shift': { sw: 'Hali ya zamu', en: 'Shift status' },
  'performance.snapshot': { sw: 'Ripoti ya mwisho', en: 'Performance snapshot' }
})

export function isKnownTool(name: string): name is ToolName {
  return name in TOOL_CARD_ROUTING
}
