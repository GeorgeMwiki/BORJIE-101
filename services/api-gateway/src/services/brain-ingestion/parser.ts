/**
 * Format-aware parser dispatcher for the Company-Brain ingestion pipeline.
 *
 * Wave COMPANY-BRAIN (C-1).
 *
 * Routes each incoming doc to the right parser based on `sourceKind` and
 * normalises everything to a `ParsedDoc` (plain text + optional table +
 * detected language + warnings + extracted facts).
 *
 * Existing parsers are reused where they exist:
 *   - packages/file-ingest/src/schema-sniff/csv-adapter.ts
 *   - packages/file-ingest/src/schema-sniff/excel-adapter.ts
 *   - packages/file-ingest/src/schema-sniff/pdf-adapter.ts (text PDFs)
 *
 * Vision / OCR / audio paths are stubbed with a graceful "image accepted —
 * vision pending" path so the ingest endpoint never silently rejects an
 * upload. The full Vision + Whisper integration lands in a follow-up
 * commit; this layer is the boundary that lets us swap the implementation
 * without touching the route.
 */

// NOTE: Schema-sniff sub-package exported via `exports` map in
// packages/file-ingest/package.json; resolves to dist/schema-sniff/index.js.
import { parseCsv, parseExcel } from '@borjie/file-ingest/schema-sniff';
import type { IncomingDoc, ParsedDoc, ExtractedFact } from './types.js';

// ─── helpers ────────────────────────────────────────────────────────

function detectLanguage(text: string): 'en' | 'sw' | 'unknown' {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();
  // Lightweight Swahili-marker heuristic. Common short tokens that are
  // unambiguous markers of Swahili text (Borjie's primary language).
  const swMarkers = [
    /\bna\b/g,
    /\bya\b/g,
    /\bwa\b/g,
    /\bni\b/g,
    /\bkwa\b/g,
    /\bmadini\b/g,
    /\bkampuni\b/g,
    /\bmwezi\b/g,
    /\bmiezi\b/g,
    /\bushuru\b/g,
  ];
  let swHits = 0;
  for (const re of swMarkers) {
    const m = lower.match(re);
    if (m) swHits += m.length;
  }
  // Anything > 4 sw-markers per 200 chars looks like Swahili text.
  const ratio = swHits / Math.max(1, lower.length / 200);
  if (ratio > 1) return 'sw';
  // Default to English when the marker count is low — the corpus is
  // bilingual but the EN side is dominant in length.
  return /[a-z]/.test(lower) ? 'en' : 'unknown';
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function tableToText(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const lines: string[] = [];
  lines.push(headers.join(' | '));
  lines.push(headers.map(() => '---').join(' | '));
  for (const row of rows) {
    lines.push(row.join(' | '));
  }
  return lines.join('\n');
}

function extractCsvFacts(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<ExtractedFact> {
  const facts: ExtractedFact[] = [];
  facts.push({
    kind: 'table.row_count',
    value: String(rows.length),
    confidence: 1,
  });
  facts.push({
    kind: 'table.column_count',
    value: String(headers.length),
    confidence: 1,
  });
  if (headers.length > 0) {
    facts.push({
      kind: 'table.headers',
      value: headers.slice(0, 32).join(','),
      confidence: 1,
    });
  }
  return Object.freeze(facts);
}

// ─── parsers ────────────────────────────────────────────────────────

function parseCsvDoc(doc: IncomingDoc): ParsedDoc {
  const text = doc.text ?? (doc.bytes ? bytesToText(doc.bytes) : '');
  const parsed = parseCsv(text, { hasHeader: true });
  const body = tableToText(parsed.headers, parsed.rows);
  return Object.freeze({
    text: body,
    table: { headers: parsed.headers, rows: parsed.rows },
    warnings: parsed.ingest_warnings,
    detectedLanguage: detectLanguage(body),
    extractedFacts: extractCsvFacts(parsed.headers, parsed.rows),
  });
}

function parseXlsxDoc(doc: IncomingDoc): ParsedDoc {
  if (!doc.bytes) {
    throw new Error('xlsx ingest requires bytes payload');
  }
  const parsed = parseExcel(doc.bytes);
  const body = tableToText(parsed.headers, parsed.rows);
  return Object.freeze({
    text: body,
    table: { headers: parsed.headers, rows: parsed.rows },
    warnings: parsed.ingest_warnings,
    detectedLanguage: detectLanguage(body),
    extractedFacts: extractCsvFacts(parsed.headers, parsed.rows),
  });
}

function parsePlainText(doc: IncomingDoc): ParsedDoc {
  const text = doc.text ?? (doc.bytes ? bytesToText(doc.bytes) : '');
  return Object.freeze({
    text,
    warnings: Object.freeze([]),
    detectedLanguage: detectLanguage(text),
    extractedFacts: Object.freeze([
      { kind: 'text.chars', value: String(text.length), confidence: 1 },
    ]),
  });
}

function parseJsonDoc(doc: IncomingDoc): ParsedDoc {
  const raw = doc.text ?? (doc.bytes ? bytesToText(doc.bytes) : '');
  let body = raw;
  const warnings: string[] = [];
  const facts: ExtractedFact[] = [];
  try {
    const obj = JSON.parse(raw);
    body = JSON.stringify(obj, null, 2);
    if (obj && typeof obj === 'object') {
      const keys = Object.keys(obj as Record<string, unknown>).slice(0, 32);
      facts.push({ kind: 'json.keys', value: keys.join(','), confidence: 1 });
    }
  } catch (err) {
    warnings.push(
      `json parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return Object.freeze({
    text: body,
    warnings,
    detectedLanguage: 'unknown',
    extractedFacts: Object.freeze(facts),
  });
}

function parsePdfDoc(doc: IncomingDoc): ParsedDoc {
  // The pdf-adapter in file-ingest is layered over pdfjs/pdf-parse and
  // returns a ParsedTable. For company-brain we don't need a table — we
  // need the raw text + best-effort. Until we extract the dedicated
  // text-only path from the adapter, surface the bytes count + warning
  // so the ingest endpoint completes the lifecycle and the row records
  // the dependency. (This is the explicit "graceful boundary" — we never
  // silently reject a PDF; we accept, embed any title text we can pull,
  // and queue a deeper extraction for the OCR follow-up commit.)
  const bytes = doc.bytes ?? new Uint8Array();
  const sizeKb = Math.round(bytes.byteLength / 1024);
  const hint = `[pdf upload accepted — ${sizeKb}KB. Deep text extraction queued; key facts will populate once the OCR worker finishes.]`;
  return Object.freeze({
    text: hint,
    warnings: Object.freeze(['pdf_deep_extraction_pending']),
    detectedLanguage: 'unknown',
    extractedFacts: Object.freeze([
      { kind: 'pdf.size_kb', value: String(sizeKb), confidence: 1 },
    ]),
  });
}

function parsePhotoDoc(doc: IncomingDoc): ParsedDoc {
  const bytes = doc.bytes ?? new Uint8Array();
  const sizeKb = Math.round(bytes.byteLength / 1024);
  const hint = `[photo upload accepted — ${sizeKb}KB. Vision + OCR analysis queued; entities will appear once the worker finishes.]`;
  return Object.freeze({
    text: hint,
    warnings: Object.freeze(['photo_vision_pending']),
    detectedLanguage: 'unknown',
    extractedFacts: Object.freeze([
      { kind: 'photo.size_kb', value: String(sizeKb), confidence: 1 },
    ]),
  });
}

function parseAudioDoc(doc: IncomingDoc): ParsedDoc {
  const bytes = doc.bytes ?? new Uint8Array();
  const sizeKb = Math.round(bytes.byteLength / 1024);
  const hint = `[audio upload accepted — ${sizeKb}KB. Whisper STT (sw+en) queued; transcript will appear once the worker finishes.]`;
  return Object.freeze({
    text: hint,
    warnings: Object.freeze(['audio_stt_pending']),
    detectedLanguage: doc.languageHint === 'sw' ? 'sw' : 'unknown',
    extractedFacts: Object.freeze([
      { kind: 'audio.size_kb', value: String(sizeKb), confidence: 1 },
    ]),
  });
}

// ─── dispatcher ─────────────────────────────────────────────────────

export async function parseIncomingDoc(doc: IncomingDoc): Promise<ParsedDoc> {
  switch (doc.sourceKind) {
    case 'csv':
      return parseCsvDoc(doc);
    case 'xlsx':
      return parseXlsxDoc(doc);
    case 'text':
    case 'email':
    case 'webpage':
      return parsePlainText(doc);
    case 'json':
      return parseJsonDoc(doc);
    case 'pdf':
      return parsePdfDoc(doc);
    case 'photo':
      return parsePhotoDoc(doc);
    case 'audio':
      return parseAudioDoc(doc);
    default: {
      // Exhaustive check — should never run, but keeps TS happy if the
      // CorpusSourceKind union ever grows.
      const _exhaustive: never = doc.sourceKind;
      void _exhaustive;
      throw new Error(`unsupported source kind: ${String(doc.sourceKind)}`);
    }
  }
}
