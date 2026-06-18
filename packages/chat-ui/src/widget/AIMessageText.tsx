'use client';

/**
 * AIMessageText — Borjie-skinned widget message renderer.
 *
 * Strips residual protocol tags (<ui_block>, [QUICK_REPLIES],
 * [EXTRACTION_TABLE], [CONCEPT_CARD], [QUIZ_BLOCK]) that the streaming pipeline
 * may leak, then renders the result as paragraphs + bullet lists with **bold**.
 *
 * NOTE: this renderer USED to also rewrite ' - ' -> '. ' and force-capitalize
 * after every period, to turn un-rendered bullets into prose. That mangled
 * legitimate content — mineral grades ("0.6 grade" -> "0.6 Grade"), numeric
 * ranges ("5 - 10 g/t" -> "5. 10 g/t"), hyphenated terms. Those destructive
 * transforms were removed; bullet lines now render as real <li> instead, so the
 * model's output reaches the visitor faithfully.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/AIMessageText.tsx
 */

import { useMemo, type JSX } from 'react';

interface AIMessageTextProps {
  readonly content: string;
  readonly className?: string;
}

/** Strip residual protocol tags the SSE pipeline may leak into the text. */
function cleanForDisplay(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<ui_block>[\s\S]*?<\/ui_block>/gi, '');
  cleaned = cleaned.replace(/<ui_block>[\s\S]*$/i, '');
  cleaned = cleaned.replace(
    /\s*\[QUICK_REPLIES\][\s\S]*?\[\/QUICK_REPLIES\][>\s]*/gi,
    '',
  );
  cleaned = cleaned.replace(/\s*\[QUICK_REPLIES\][\s\S]*$/i, '');
  cleaned = cleaned.replace(
    /\s*\[\/?(QUICK_REPLIES|EXTRACTION_TABLE|CONCEPT_CARD|QUIZ_BLOCK)\]\s*/gi,
    '',
  );
  return cleaned.trim();
}

const BULLET_RE = /^\s*[-*]\s+/;

/** Render **bold** spans + single-newline <br/> within one text run. */
function renderBold(text: string, keyBase: string): ReadonlyArray<JSX.Element> {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyBase}-b${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const lines = part.split('\n');
    return (
      <span key={`${keyBase}-s${i}`}>
        {lines.map((ln, lnIdx) => (
          <span key={lnIdx}>
            {ln}
            {lnIdx < lines.length - 1 && <br />}
          </span>
        ))}
      </span>
    );
  });
}

/**
 * Render the cleaned text into <p> blocks and <ul> bullet lists. Consecutive
 * lines beginning with `- ` / `* ` are grouped into one list; everything else
 * accumulates into paragraphs (blank lines separate paragraphs).
 */
function renderBlocks(text: string): ReadonlyArray<JSX.Element> {
  const lines = text.split('\n');
  const out: JSX.Element[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length === 0) return;
    const key = `p${out.length}`;
    out.push(
      <p key={key} className="my-1 first:mt-0 last:mb-0">
        {renderBold(para.join('\n'), key)}
      </p>,
    );
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (BULLET_RE.test(ln)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, ''));
        i += 1;
      }
      const key = `u${out.length}`;
      out.push(
        <ul key={key} className="my-1 list-disc pl-5">
          {items.map((item, k) => (
            <li key={k}>{renderBold(item, `${key}-${k}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (ln.trim() === '') {
      flushPara();
      i += 1;
      continue;
    }
    para.push(ln);
    i += 1;
  }
  flushPara();
  return out;
}

export function AIMessageText({
  content,
  className,
}: AIMessageTextProps): JSX.Element | null {
  const displayContent = useMemo(() => cleanForDisplay(content), [content]);
  if (!displayContent) return null;
  return (
    <div
      className={
        className ??
        'prose prose-sm max-w-none dark:prose-invert prose-headings:my-2 prose-li:my-0.5 prose-p:my-1 prose-strong:font-semibold break-words'
      }
    >
      {renderBlocks(displayContent)}
    </div>
  );
}
