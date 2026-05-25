/**
 * Color coding — per-element hex palette per layer-kind.
 *
 * Pure function. No side effects. No DOM. Used both server-side (to
 * compute MVT tile properties) and client-side (to paint MapLibre
 * fill-color expressions).
 *
 * Palette choice mirrors the WCAG-AA-tested status palette already
 * used by the BORJIE dashboards (green = good, amber = warn,
 * red = bad, gray = unknown). See Refactoring UI status semantics.
 */

import type {
  OccupancyStatus,
  ElementStatus,
  ElementCondition,
  MapLayerKind,
} from './types.js';

// ============================================================================
// Per-status palettes
// ============================================================================

const OCCUPANCY_COLORS: Readonly<Record<OccupancyStatus, string>> = {
  vacant: '#9CA3AF',           // gray-400
  occupied: '#10B981',         // emerald-500
  reserved: '#3B82F6',         // blue-500
  under_maintenance: '#F59E0B',// amber-500
  not_available: '#6B7280',    // gray-500
  unknown: '#D1D5DB',          // gray-300
};

const STATUS_COLORS: Readonly<Record<ElementStatus, string>> = {
  operational: '#10B981',      // emerald-500
  degraded: '#F59E0B',         // amber-500
  broken: '#EF4444',           // red-500
  needs_repair: '#F97316',     // orange-500
  decommissioned: '#6B7280',   // gray-500
  unknown: '#D1D5DB',          // gray-300
};

const CONDITION_COLORS: Readonly<Record<ElementCondition, string>> = {
  excellent: '#059669',        // emerald-600
  good: '#10B981',             // emerald-500
  fair: '#F59E0B',             // amber-500
  poor: '#F97316',             // orange-500
  critical: '#DC2626',         // red-600
  unknown: '#D1D5DB',          // gray-300
};

const ARREARS_COLORS = [
  { upTo: 0, hex: '#10B981' },     // current
  { upTo: 7, hex: '#FCD34D' },     // 1-7 days
  { upTo: 30, hex: '#F59E0B' },    // 8-30 days
  { upTo: 60, hex: '#F97316' },    // 31-60 days
  { upTo: Infinity, hex: '#DC2626' }, // 60+
] as const;

const FALLBACK = '#9CA3AF';

// ============================================================================
// Public API
// ============================================================================

export function colorForOccupancy(status: OccupancyStatus): string {
  return OCCUPANCY_COLORS[status] ?? FALLBACK;
}

export function colorForStatus(status: ElementStatus): string {
  return STATUS_COLORS[status] ?? FALLBACK;
}

export function colorForCondition(condition: ElementCondition): string {
  return CONDITION_COLORS[condition] ?? FALLBACK;
}

/**
 * Map an arrears age (in days) to a status hex. Negative values are
 * treated as zero (paid early). NaN/Infinity returns the fallback.
 */
export function colorForArrearsDays(days: number): string {
  if (!Number.isFinite(days)) return FALLBACK;
  const d = Math.max(0, days);
  for (const band of ARREARS_COLORS) {
    if (d <= band.upTo) return band.hex;
  }
  return FALLBACK;
}

/**
 * Per-layer-kind dispatch. The `value` is the row-specific signal
 * (a status string for status/occupancy layers, a number for
 * arrears/maintenance). Unrecognised kinds and values fall back to a
 * neutral gray rather than throwing.
 */
export function colorForLayer(kind: MapLayerKind, value: unknown): string {
  switch (kind) {
    case 'occupancy':
      return typeof value === 'string'
        ? colorForOccupancy(value as OccupancyStatus)
        : FALLBACK;
    case 'status':
      return typeof value === 'string'
        ? colorForStatus(value as ElementStatus)
        : FALLBACK;
    case 'condition':
      return typeof value === 'string'
        ? colorForCondition(value as ElementCondition)
        : FALLBACK;
    case 'arrears':
      return typeof value === 'number'
        ? colorForArrearsDays(value)
        : FALLBACK;
    case 'maintenance':
      // 'maintenance' uses the same status palette as 'status'
      return typeof value === 'string'
        ? colorForStatus(value as ElementStatus)
        : FALLBACK;
    case 'compliance':
      // 'compliance' values: 'compliant' | 'expiring' | 'expired'
      if (value === 'compliant') return '#10B981';
      if (value === 'expiring') return '#F59E0B';
      if (value === 'expired') return '#DC2626';
      return FALLBACK;
    case 'rent_band':
      // Numeric band: lower rent => lighter, higher rent => darker.
      if (typeof value !== 'number' || !Number.isFinite(value)) return FALLBACK;
      if (value < 25000) return '#DBEAFE';
      if (value < 50000) return '#93C5FD';
      if (value < 100000) return '#3B82F6';
      if (value < 250000) return '#1D4ED8';
      return '#1E3A8A';
    case 'custom':
      // Custom layers do their own coding; return fallback so callers
      // see something neutral when they forget to override.
      return FALLBACK;
    default:
      return FALLBACK;
  }
}

export const PALETTE = Object.freeze({
  occupancy: OCCUPANCY_COLORS,
  status: STATUS_COLORS,
  condition: CONDITION_COLORS,
  fallback: FALLBACK,
});
