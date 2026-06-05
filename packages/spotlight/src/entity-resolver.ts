/**
 * Entity Resolver — maps natural-language references to concrete entity IDs.
 *
 * Examples:
 *  "unit 4B at Geita"      -> { kind: 'unit', id: 'u_123', label: '4B — Geita' }
 *  "pit 12 Nachingwea"     -> { kind: 'unit', id: 'u_456', label: '12 — Nachingwea' }
 *  "buyer Jane Mwangi"     -> { kind: 'counterparty', id: 'c_789', label: 'Jane Mwangi' }
 *
 * The resolver is deterministic: the same query + index yields the same
 * ranking. Scoring uses token overlap + site-name co-occurrence.
 */

import type { EntityIndex } from './spotlight-engine.js';

export interface EntityMatch {
  readonly kind: 'unit' | 'site' | 'counterparty';
  readonly id: string;
  readonly label: string;
  readonly context?: string;
  readonly score: number;
}

const UNIT_PATTERN = /\b(?:unit|pit|block|shaft|adit|plot)\s*([A-Z0-9][A-Z0-9\-/]{0,10})\b/i;

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
      if (u.siteName && u.siteName.toLowerCase().includes(tok)) score += 0.3;
    }
    if (score > 0)
      matches.push({
        kind: 'unit',
        id: u.id,
        label: `${u.label}${u.siteName ? ` — ${u.siteName}` : ''}`,
        context: u.siteName ?? '',
        score: Math.min(1, score),
      });
  }

  for (const s of index.sites) {
    let score = 0;
    const name = s.name.toLowerCase();
    for (const tok of tokens) {
      if (name.includes(tok)) score += 0.4;
    }
    if (score > 0)
      matches.push({
        kind: 'site',
        id: s.id,
        label: s.name,
        score: Math.min(1, score),
      });
  }

  for (const c of index.counterparties) {
    let score = 0;
    const name = c.name.toLowerCase();
    for (const tok of tokens) {
      if (name.includes(tok)) score += 0.35;
    }
    if (score > 0)
      matches.push({
        kind: 'counterparty',
        id: c.id,
        label: c.name,
        score: Math.min(1, score),
      });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 8);
}
