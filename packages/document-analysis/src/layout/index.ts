/**
 * Layout parser. Produces structural hints from extracted text:
 *
 *   - approximate page boundaries (from form-feed and explicit markers)
 *   - table-like blocks (detected by aligned column-spaced lines)
 *   - signature-block heuristics ("Signed:", "Name:", lines under a row)
 *   - stamp / seal markers ("[STAMP]", "Official Seal of ...")
 *   - photo-region markers ("[PHOTO]", "Image attached")
 *
 * Bounding boxes from real PDFs come from `pdfjs-dist` (lazy import),
 * but for born-digital text and fixtures we synthesise pseudo-bboxes
 * keyed off line numbers. That way every extraction stage downstream
 * can attach a `page + bbox` even when the source is plain text.
 *
 * Pseudo-bbox convention: `{ x: 0, y: lineIndex, w: lineLength, h: 1 }`
 * — units are "character cells", documented so the frontend renderer
 * knows how to scale.
 */

import type { BBox } from '../types.js';

export const PSEUDO_BBOX_UNIT = 'character_cells' as const;

export interface LayoutLine {
  readonly page: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly bbox: BBox;
}

export interface LayoutBlock {
  readonly kind: 'paragraph' | 'table' | 'signature' | 'stamp' | 'photo';
  readonly page: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly bbox: BBox;
  /** Tabular blocks only: rows of cells. */
  readonly tableRows?: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ParsedLayout {
  readonly pageCount: number;
  readonly lines: ReadonlyArray<LayoutLine>;
  readonly blocks: ReadonlyArray<LayoutBlock>;
}

const PAGE_BREAK_MARKERS = [/^---\s*page\s*break\s*---$/i];
const COL_SPLIT_RX = /\s{2,}|\t+|\|/;
const MIN_TABLE_RUN = 2;

const SIGNATURE_PATTERNS = [
  /^sign(ed|ature)\b/i,
  /^name\s*:\s*/i,
  /^witnessed\s+by\b/i,
  /^x_+/,
  /^_{6,}/,
];

const STAMP_PATTERNS = [
  /\[\s*stamp[^\]]*\]/i,
  /\[\s*seal[^\]]*\]/i,
  /official\s+(stamp|seal)/i,
];

const PHOTO_PATTERNS = [
  /\[\s*photo[^\]]*\]/i,
  /\[\s*image[^\]]*\]/i,
  /image\s+attached/i,
];

function isPageBreak(line: string): boolean {
  // Either a literal form-feed character anywhere in the line (PDF page
  // boundary), or one of the explicit markers (test fixtures).
  if (line.includes('\f')) return true;
  return PAGE_BREAK_MARKERS.some((rx) => rx.test(line.trim()));
}

function buildPseudoBbox(lineIndex: number, lineText: string): BBox {
  return { x: 0, y: lineIndex, w: lineText.length, h: 1 };
}

function detectTableRun(
  lines: ReadonlyArray<string>,
  start: number,
): { end: number; rows: string[][] } | null {
  // Split each candidate row on the column delimiter.
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw || raw.trim().length === 0) break;
    const cells = raw.split(COL_SPLIT_RX).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) break;
    rows.push(cells);
    i += 1;
  }
  if (rows.length < MIN_TABLE_RUN) return null;
  // Most rows must share column count (≥80%).
  const counts = new Map<number, number>();
  for (const r of rows) {
    counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  }
  const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!dominant) return null;
  const consensus = dominant[1] / rows.length;
  if (consensus < 0.8) return null;
  return { end: start + rows.length - 1, rows };
}

/**
 * Parse layout from text. Optional `mimeType` allows the lazy pdfjs
 * path to kick in for real PDFs (production), but for tests + plain-text
 * fixtures we synthesise blocks deterministically.
 */
export async function parseLayout(input: {
  readonly text: string;
  readonly mimeType?: string;
}): Promise<ParsedLayout> {
  const lines = input.text.split(/\r?\n/);
  const layoutLines: LayoutLine[] = [];
  const blocks: LayoutBlock[] = [];

  let currentPage = 1;
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    if (isPageBreak(raw)) {
      currentPage += 1;
      i += 1;
      continue;
    }

    layoutLines.push({
      page: currentPage,
      lineIndex: i,
      text: raw,
      bbox: buildPseudoBbox(i, raw),
    });

    // Block detection.
    if (raw.trim().length === 0) {
      i += 1;
      continue;
    }

    const tableRun = detectTableRun(lines, i);
    if (tableRun) {
      const tableText = lines.slice(i, tableRun.end + 1).join('\n');
      blocks.push({
        kind: 'table',
        page: currentPage,
        startLine: i,
        endLine: tableRun.end,
        text: tableText,
        bbox: { x: 0, y: i, w: Math.max(...tableRun.rows.map((r) => r.join('|').length)), h: tableRun.rows.length },
        tableRows: tableRun.rows,
      });
      // Record subsequent lines as well so downstream gets them.
      for (let k = i + 1; k <= tableRun.end; k += 1) {
        const r = lines[k] ?? '';
        layoutLines.push({
          page: currentPage,
          lineIndex: k,
          text: r,
          bbox: buildPseudoBbox(k, r),
        });
      }
      i = tableRun.end + 1;
      continue;
    }

    if (SIGNATURE_PATTERNS.some((rx) => rx.test(raw.trim()))) {
      blocks.push({
        kind: 'signature',
        page: currentPage,
        startLine: i,
        endLine: i,
        text: raw,
        bbox: buildPseudoBbox(i, raw),
      });
    } else if (STAMP_PATTERNS.some((rx) => rx.test(raw))) {
      blocks.push({
        kind: 'stamp',
        page: currentPage,
        startLine: i,
        endLine: i,
        text: raw,
        bbox: buildPseudoBbox(i, raw),
      });
    } else if (PHOTO_PATTERNS.some((rx) => rx.test(raw))) {
      blocks.push({
        kind: 'photo',
        page: currentPage,
        startLine: i,
        endLine: i,
        text: raw,
        bbox: buildPseudoBbox(i, raw),
      });
    }
    i += 1;
  }

  return {
    pageCount: currentPage,
    lines: layoutLines,
    blocks,
  };
}

/**
 * Helper: find the bbox + page where a substring appears. Used by the
 * extract stage so every extraction carries a citation.
 */
export function locateInLayout(
  layout: ParsedLayout,
  needle: string,
): { page: number; bbox: BBox } | null {
  const search = needle.trim().toLowerCase();
  if (search.length === 0) return null;
  for (const line of layout.lines) {
    const haystack = line.text.toLowerCase();
    const idx = haystack.indexOf(search);
    if (idx >= 0) {
      return {
        page: line.page,
        bbox: { x: idx, y: line.lineIndex, w: search.length, h: 1 },
      };
    }
  }
  return null;
}
