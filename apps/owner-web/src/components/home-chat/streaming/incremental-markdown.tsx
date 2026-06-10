'use client';

/**
 * incremental-markdown — a tiny, dependency-free Markdown renderer built
 * for the streaming case, where the input is a *prefix* of the final text
 * that grows token-by-token.
 *
 * NO new npm dep (the spec forbids `streamdown`/`react-markdown`): this is
 * the existing-renderer-made-incremental. It targets the subset the brain
 * actually emits — paragraphs, headings, bullet/ordered lists, blockquotes,
 * fenced code blocks, inline code, bold, italic and links — and is hardened
 * against the half-written states a stream produces:
 *
 *   - An OPEN ``` code fence (no closing fence yet) is held back as a
 *     "pending code" block so a half-typed snippet never flashes as a broken
 *     block then re-lays-out when the fence closes.
 *   - A dangling `**`, `*`, `` ` `` or `[label](partial` is rendered as
 *     literal text until it completes, so the line never flickers between
 *     bold/plain on each token.
 *   - Finalized blocks (every block *before* the last one while streaming —
 *     and ALL blocks once complete) are MEMOIZED by their source string, so
 *     earlier paragraphs are not re-parsed on every chunk.
 *
 * Security: this renderer NEVER emits raw HTML. It builds React elements
 * directly from parsed spans, so there is no `dangerouslySetInnerHTML` path
 * and no DOMPurify dependency — untrusted model text can only ever become
 * text nodes or known-safe anchor/code/strong/em elements. Link `href`s are
 * scheme-gated to http(s)/mailto.
 */

import { Fragment, memo, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@borjie/design-system';

type Block =
  | { readonly kind: 'p'; readonly src: string }
  | { readonly kind: 'h'; readonly level: 1 | 2 | 3; readonly src: string }
  | { readonly kind: 'ul'; readonly items: ReadonlyArray<string>; readonly src: string }
  | { readonly kind: 'ol'; readonly items: ReadonlyArray<string>; readonly src: string }
  | { readonly kind: 'quote'; readonly src: string }
  | {
      readonly kind: 'code';
      readonly code: string;
      readonly lang: string | null;
      readonly closed: boolean;
      readonly src: string;
    };

const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * Split the streamed source into blocks. The final fenced code block is kept
 * even when its closing ``` has not arrived (marked `closed: false`) so its
 * skeleton can render without flicker.
 */
function splitBlocks(source: string): ReadonlyArray<Block> {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trimStart();

    // Fenced code block.
    const fence = trimmed.match(/^```(.*)$/);
    if (fence) {
      const lang = (fence[1] ?? '').trim() || null;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const inner = lines[j] ?? '';
        if (inner.trimStart().startsWith('```')) {
          closed = true;
          break;
        }
        body.push(inner);
        j += 1;
      }
      const src = lines.slice(i, closed ? j + 1 : j).join('\n');
      blocks.push({ kind: 'code', code: body.join('\n'), lang, closed, src });
      i = closed ? j + 1 : j;
      continue;
    }

    // Blank line — skip.
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    // Heading.
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = (heading[1]?.length ?? 1) as 1 | 2 | 3;
      blocks.push({ kind: 'h', level, src: heading[2] ?? '' });
      i += 1;
      continue;
    }

    // Blockquote (collapse consecutive `>` lines).
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j] ?? '').trimStart().startsWith('>')) {
        quoteLines.push((lines[j] ?? '').trimStart().replace(/^>\s?/, ''));
        j += 1;
      }
      blocks.push({ kind: 'quote', src: quoteLines.join('\n') });
      i = j;
      continue;
    }

    // Unordered list.
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length && /^[-*+]\s+/.test((lines[j] ?? '').trimStart())) {
        items.push((lines[j] ?? '').trimStart().replace(/^[-*+]\s+/, ''));
        j += 1;
      }
      blocks.push({ kind: 'ul', items, src: lines.slice(i, j).join('\n') });
      i = j;
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      let j = i;
      while (j < lines.length && /^\d+\.\s+/.test((lines[j] ?? '').trimStart())) {
        items.push((lines[j] ?? '').trimStart().replace(/^\d+\.\s+/, ''));
        j += 1;
      }
      blocks.push({ kind: 'ol', items, src: lines.slice(i, j).join('\n') });
      i = j;
      continue;
    }

    // Paragraph — gather consecutive non-blank, non-special lines.
    const paraLines: string[] = [];
    let j = i;
    while (j < lines.length) {
      const candidate = (lines[j] ?? '').trimStart();
      if (
        candidate.length === 0 ||
        candidate.startsWith('```') ||
        candidate.startsWith('>') ||
        /^(#{1,3})\s+/.test(candidate) ||
        /^[-*+]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate)
      ) {
        break;
      }
      paraLines.push(lines[j] ?? '');
      j += 1;
    }
    blocks.push({ kind: 'p', src: paraLines.join('\n') });
    i = j;
  }

  return blocks;
}

/**
 * Render inline spans (bold / italic / code / links) for a single text run.
 * Dangling delimiters render as literal text — the regexes only match the
 * CLOSED forms, so a half-open `**bold` stays plain until the stream closes
 * it. Returns an array of React nodes keyed by position.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let cursor = 0;

  // Ordered by precedence: code span first (so its contents aren't re-parsed),
  // then links, then bold, then italic.
  const patterns: ReadonlyArray<{
    readonly re: RegExp;
    readonly build: (m: RegExpExecArray, key: string) => ReactNode;
  }> = [
    {
      re: /`([^`\n]+)`/,
      build: (m, key) => (
        <code
          key={key}
          className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {m[1]}
        </code>
      ),
    },
    {
      re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/,
      build: (m, key) => {
        const href = m[2] ?? '';
        if (!SAFE_SCHEME.test(href)) {
          return <Fragment key={key}>{m[0]}</Fragment>;
        }
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
          >
            {m[1]}
          </a>
        );
      },
    },
    {
      re: /\*\*([^*\n]+)\*\*/,
      build: (m, key) => (
        <strong key={key} className="font-semibold text-foreground">
          {m[1]}
        </strong>
      ),
    },
    {
      re: /(?<![*])\*([^*\n]+)\*(?![*])/,
      build: (m, key) => (
        <em key={key} className="italic">
          {m[1]}
        </em>
      ),
    },
  ];

  // Iteratively consume the earliest match across all patterns.
  // Guard against pathological inputs with a hard iteration cap.
  let guard = 0;
  while (remaining.length > 0 && guard < 5000) {
    guard += 1;
    let best: { index: number; match: RegExpExecArray; build: (m: RegExpExecArray, key: string) => ReactNode } | null =
      null;
    for (const { re, build } of patterns) {
      const m = re.exec(remaining);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, match: m, build };
      }
    }
    if (best === null) {
      nodes.push(<Fragment key={`${keyPrefix}_t${cursor}`}>{remaining}</Fragment>);
      break;
    }
    if (best.index > 0) {
      nodes.push(
        <Fragment key={`${keyPrefix}_t${cursor}`}>
          {remaining.slice(0, best.index)}
        </Fragment>,
      );
    }
    nodes.push(best.build(best.match, `${keyPrefix}_m${cursor}`));
    cursor += 1;
    remaining = remaining.slice(best.index + best.match[0].length);
  }

  return nodes;
}

function BlockView({ block, k }: { block: Block; k: string }): ReactElement {
  switch (block.kind) {
    case 'h': {
      const cls =
        block.level === 1
          ? 'text-base font-semibold text-foreground mt-3 first:mt-0'
          : block.level === 2
            ? 'text-[0.95rem] font-semibold text-foreground mt-3 first:mt-0'
            : 'text-sm font-semibold text-foreground mt-2 first:mt-0';
      return <p className={cls}>{renderInline(block.src, k)}</p>;
    }
    case 'ul':
      return (
        <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-foreground/40">
          {block.items.map((item, idx) => (
            <li key={`${k}_li${idx}`}>{renderInline(item, `${k}_li${idx}`)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-foreground/40">
          {block.items.map((item, idx) => (
            <li key={`${k}_li${idx}`}>{renderInline(item, `${k}_li${idx}`)}</li>
          ))}
        </ol>
      );
    case 'quote':
      return (
        <blockquote className="my-2 border-l-2 border-warning/40 pl-3 text-foreground/80">
          {renderInline(block.src, k)}
        </blockquote>
      );
    case 'code':
      return (
        <pre
          data-pending={block.closed ? undefined : true}
          className={cn(
            'my-2 overflow-x-auto rounded-lg border border-border bg-foreground/[0.04] p-3 text-[0.8rem] leading-relaxed',
            !block.closed && 'opacity-80',
          )}
        >
          <code className="font-mono text-foreground/90">
            {block.code || (block.closed ? '' : ' ')}
          </code>
        </pre>
      );
    case 'p':
    default:
      return (
        <p className="my-1.5 whitespace-pre-wrap leading-[1.6] first:mt-0 last:mb-0">
          {renderInline(block.src, k)}
        </p>
      );
  }
}

const MemoBlock = memo(
  BlockView,
  // Re-render a block ONLY when its source string changes. While streaming,
  // every block except the last is byte-identical between chunks, so prior
  // paragraphs skip re-parse entirely.
  (prev, next) => prev.block.src === next.block.src && prev.k === next.k,
);

export interface IncrementalMarkdownProps {
  readonly text: string;
  readonly className?: string;
}

/**
 * Render `text` as streaming-tolerant Markdown. Block splitting is memoized
 * on the source; each block is a memoized child keyed by its source so only
 * the actively-growing tail re-parses per chunk.
 */
export function IncrementalMarkdown({
  text,
  className,
}: IncrementalMarkdownProps): ReactElement {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className={cn('text-[0.9375rem] text-foreground', className)}>
      {blocks.map((block, idx) => {
        // Key earlier blocks by their stable source; key the LAST block by
        // index so its growing content updates in place rather than remounting.
        const isLast = idx === blocks.length - 1;
        const key = isLast ? `b_last` : `b_${idx}_${block.src.length}`;
        return <MemoBlock key={key} block={block} k={`mk_${idx}`} />;
      })}
    </div>
  );
}
