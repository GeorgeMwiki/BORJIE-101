/**
 * Entity Resolver — maps natural-language references to concrete entity IDs.
 *
 * Examples:
 *  "unit 4B at Goba"       -> { kind: 'unit', id: 'u_123', label: '4B — Goba' }
 *  "apartment 12 Westlands" -> { kind: 'unit', id: 'u_456', label: '12 — Westlands' }
 *  "tenant Jane Mwangi"    -> { kind: 'tenant', id: 't_789', label: 'Jane Mwangi' }
 *
 * The resolver is deterministic: the same query + index yields the same
 * ranking. Scoring uses token overlap + property-name co-occurrence.
 */

import type { EntityIndex } from './spotlight-engine.js';

export interface EntityMatch {
  readonly kind: 'unit' | 'property' | 'tenant';
  readonly id: string;
  readonly label: string;
  readonly context?: string;
  readonly score: number;
}

const UNIT_PATTERN = /\b(?:unit|apartment|flat|door|house|plot)\s*([A-Z0-9][A-Z0-9\-/]{0,10})\b/i;

export function resolveEntities(query: string, index: EntityIndex): readonly EntityMatch[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const unitRefMatch = query.match(UNIT_PATTERN);
  const unitRef = unitRefMatch?.[1]?.toLowerCase();

  const matches: EntityMatch[] = [];

  for (const u of index.units) {
    let score = 0;
    const label = u.label.toLowerCase();
    if (unitRef && label === unitRef) score += 0.9;
    else if (unitRef && label.includes(unitRef)) score += 0.6;
    for (const tok of tokens) {
      if (label.includes(tok)) score += 0.2;
      if (u.propertyName && u.propertyName.toLowerCase().includes(tok)) score += 0.3;
    }
    if (score > 0)
      matches.push({
        kind: 'unit',
        id: u.id,
        label: `${u.label}${u.propertyName ? ` — ${u.propertyName}` : ''}`,
        context: u.propertyName ?? '',
        score: Math.min(1, score),
      });
  }

  for (const p of index.properties) {
    let score = 0;
    const name = p.name.toLowerCase();
    for (const tok of tokens) {
      if (name.includes(tok)) score += 0.4;
    }
    if (score > 0)
      matches.push({
        kind: 'property',
        id: p.id,
        label: p.name,
        score: Math.min(1, score),
      });
  }

  for (const t of index.tenants) {
    let score = 0;
    const name = t.name.toLowerCase();
    for (const tok of tokens) {
      if (name.includes(tok)) score += 0.35;
    }
    if (score > 0)
      matches.push({
        kind: 'tenant',
        id: t.id,
        label: t.name,
        score: Math.min(1, score),
      });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 8);
}
