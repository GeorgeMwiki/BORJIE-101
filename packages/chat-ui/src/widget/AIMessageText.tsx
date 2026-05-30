'use client';

/**
 * AIMessageText — carbon copy of LitFin's AIMessageText, Borjie-skinned.
 * Strips residual <ui_block> / [QUICK_REPLIES] / em-dashes from streaming
 * pipeline output and renders the result as paragraphs with bold support.
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/AIMessageText.tsx
 */

import { useMemo, type JSX } from 'react';

interface AIMessageTextProps {
  readonly content: string;
  readonly className?: string;
}

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
  cleaned = cleaned
    .replace(/  - /g, '. ')
    .replace(/  -/g, '.')
    .replace(/ - /g, '. ')
    .replace(/ -/g, '. ')
    .replace(/ -- /g, '. ');
  cleaned = cleaned.replace(/\.\. /g, '. ');
  cleaned = cleaned.replace(
    /\. ([a-z])/g,
    (_, c: string) => `. ${c.toUpperCase()}`,
  );
  return cleaned.trim();
}

function renderInline(text: string): ReadonlyArray<JSX.Element> {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  return paragraphs.map((para, pIdx) => {
    const parts = para.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={pIdx} className="my-1 first:mt-0 last:mb-0">
        {parts.map((part, partIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={partIdx} className="font-semibold">
                {part.slice(2, -2)}
              </strong>
            );
          }
          const lines = part.split('\n');
          return lines.map((ln, lnIdx) => (
            <span key={`${partIdx}-${lnIdx}`}>
              {ln}
              {lnIdx < lines.length - 1 && <br />}
            </span>
          ));
        })}
      </p>
    );
  });
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
      {renderInline(displayContent)}
    </div>
  );
}
