/**
 * Entity extractor
 *
 * Pulls out structured mentions (property IDs, unit IDs, tenant names,
 * amounts, dates, districts) from each turn. Zero LLM \u2014 regex based.
 * The orchestrator uses these entities to resolve data references.
 */

import type { ExtractedEntity } from './types.js';

const PROPERTY_ID_RE = /\b(prop|property)[_-]?([A-Z0-9]{4,12})\b/gi;
const UNIT_ID_RE = /\b(unit|apt|apartment|flat)[_\- ]?([A-Z0-9]+(?:-[A-Z0-9]+)?)\b/gi;
const AMOUNT_TZS_RE =
  /\b(\d{1,3}(?:[, ]\d{3})+|\d+)\s*(?:tzs|tsh|shillings|sh)\b/gi;
const DATE_ISO_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const DATE_LONG_RE = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})\b/gi;
const DISTRICTS = [
  'Kinondoni',
  'Ilala',
  'Temeke',
  'Ubungo',
  'Kigamboni',
  'Goba',
  'Mbezi',
  'Kariakoo',
  'Masaki',
  'Mikocheni',
];

export function extractEntities(text: string): readonly ExtractedEntity[] {
  if (!text) return [];
  const entities: ExtractedEntity[] = [];

  for (const match of text.matchAll(PROPERTY_ID_RE)) {
    entities.push({
      type: 'property_id',
      value: match[2].toUpperCase(),
      confidence: 0.9,
    });
  }
  for (const match of text.matchAll(UNIT_ID_RE)) {
    entities.push({
      type: 'unit_id',
      value: match[2].toUpperCase(),
      confidence: 0.85,
    });
  }
  for (const match of text.matchAll(AMOUNT_TZS_RE)) {
    const numeric = match[1].replace(/[,\s]/g, '');
    entities.push({
      type: 'amount_tzs',
      value: numeric,
      confidence: 0.8,
    });
  }
  for (const match of text.matchAll(DATE_ISO_RE)) {
    entities.push({
      type: 'date',
      value: match[1],
      confidence: 0.95,
    });
  }
  for (const match of text.matchAll(DATE_LONG_RE)) {
    entities.push({
      type: 'date',
      value: match[1],
      confidence: 0.75,
    });
  }
  for (const district of DISTRICTS) {
    const re = new RegExp(`\\b${district}\\b`, 'i');
    if (re.test(text)) {
      entities.push({
        type: 'district',
        value: district,
        confidence: 0.9,
      });
    }
  }

  return dedupe(entities);
}

function dedupe(entities: readonly ExtractedEntity[]): readonly ExtractedEntity[] {
  const seen = new Set<string>();
  const out: ExtractedEntity[] = [];
  for (const e of entities) {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
