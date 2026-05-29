/**
 * R1 — superscript citation parser
 *
 * Splits a brief sentence into an ordered list of `text` and `citation`
 * tokens. Citation tokens preserve the raw glyph (so the renderer can
 * use it as visible label) plus the integer index that maps into the
 * `evidenceIds[]` array.
 *
 * Multi-digit citations are supported: `¹²` becomes citation index 12,
 * matching `evidenceIds[11]`. We rely on Unicode superscript code points
 * U+2070..U+2079 and U+00B2/U+00B3/U+00B9 (the older glyphs for 1, 2, 3).
 *
 * Pure helper — no React, no DOM. Lives in its own module so the
 * renderer and the test suite can both import it without bundling cost.
 */

const SUPERSCRIPT_MAP: Readonly<Record<string, number>> = {
  '⁰': 0, // ⁰
  '¹': 1, // ¹
  '²': 2, // ²
  '³': 3, // ³
  '⁴': 4, // ⁴
  '⁵': 5, // ⁵
  '⁶': 6, // ⁶
  '⁷': 7, // ⁷
  '⁸': 8, // ⁸
  '⁹': 9, // ⁹
};

export type SuperscriptToken =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'citation';
      readonly index: number;
      readonly raw: string;
    };

export function isSuperscriptDigit(char: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUPERSCRIPT_MAP, char);
}

/**
 * Walks the input once, consuming runs of plain characters into `text`
 * tokens and runs of consecutive superscript digits into `citation`
 * tokens. Single-pass, O(n), no regex backtracking.
 */
export function parseSuperscriptCitations(
  text: string,
): ReadonlyArray<SuperscriptToken> {
  const tokens: SuperscriptToken[] = [];
  let textBuf = '';
  let digitBuf = '';

  const flushText = (): void => {
    if (textBuf.length > 0) {
      tokens.push({ kind: 'text', value: textBuf });
      textBuf = '';
    }
  };

  const flushDigits = (): void => {
    if (digitBuf.length === 0) return;
    let index = 0;
    for (const ch of digitBuf) {
      index = index * 10 + (SUPERSCRIPT_MAP[ch] ?? 0);
    }
    tokens.push({ kind: 'citation', index, raw: digitBuf });
    digitBuf = '';
  };

  for (const ch of text) {
    if (isSuperscriptDigit(ch)) {
      flushText();
      digitBuf += ch;
    } else {
      flushDigits();
      textBuf += ch;
    }
  }
  flushText();
  flushDigits();

  return tokens;
}
