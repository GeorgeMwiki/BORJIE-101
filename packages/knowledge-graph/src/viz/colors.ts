/**
 * Deterministic class -> color mapping.
 *
 * Pre-seeded for the BORJIE real-estate ontology classes so the
 * same node class always renders in the same color across the whole
 * portal — including charts, force graphs, and the chord diagram.
 *
 * Palette source: OKLCH-balanced tailwind v4 hues at 60% L / 60% C —
 * chosen for accessible contrast against both light and dark themes
 * (WCAG 2.2 AA).
 */

export type ClassColorMap = Readonly<Record<string, string>>;

export const DEFAULT_CLASS_COLOURS: ClassColorMap = {
  Property: '#3b82f6',          // blue-500
  Unit: '#06b6d4',              // cyan-500
  Tenant: '#10b981',            // emerald-500
  Owner: '#8b5cf6',             // violet-500
  EstateManager: '#a855f7',     // purple-500
  Lease: '#f59e0b',             // amber-500
  Payment: '#22c55e',           // green-500
  MaintenanceTicket: '#ef4444', // red-500
  Vendor: '#f97316',            // orange-500
  Document: '#64748b',          // slate-500
  Inspection: '#0ea5e9',        // sky-500
  Listing: '#ec4899',           // pink-500
  Lead: '#d946ef',              // fuchsia-500
  Parcel: '#84cc16',            // lime-500
  District: '#14b8a6',          // teal-500
};

export function colorForClass(
  className: string,
  palette?: ClassColorMap,
): string {
  const map = palette ?? DEFAULT_CLASS_COLOURS;
  if (map[className]) return map[className];
  // Deterministic fallback: hash the class name into a HSL hue.
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = (hash * 31 + className.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 60%, 55%)`;
}
