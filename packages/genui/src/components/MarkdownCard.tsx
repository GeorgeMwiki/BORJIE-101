'use client';

/**
 * 14. markdown-card — rich narrative block with optional citations.
 *
 * Ships a small no-dep inline markdown renderer covering: headings,
 * bold, italic, inline code, links, bullet lists, code fences and
 * [cite:<id>] citation markers (rendered as superscript chips that
 * link to the citation list below the body).
 *
 * Intentionally NOT pulling in react-markdown — the genui package
 * stays peer-dep-free. If a richer renderer is needed, the host app
 * can swap MarkdownCard for its own component at the AdaptiveRenderer
 * boundary.
 */

import { useMemo } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { MarkdownCardPartSchema } from '../schemas';

export type MarkdownCardProps = AgUiUiPartByKind<'markdown-card'>;

const SEVERITY_CLASS: Record<string, string> = {
  info: 'border-l-4 border-l-blue-500',
  warning: 'border-l-4 border-l-yellow-500',
  success: 'border-l-4 border-l-green-500',
  danger: 'border-l-4 border-l-red-500',
};

/**
 * CRITICAL (C3) — escape every character that has special meaning in an
 * HTML attribute context, not just `& < >`. The link renderer below
 * injects the LLM-emitted href into `<a ... href="..."> </a>`, which is
 * an attribute context: a `"` inside the href closes the attribute and
 * lets an attacker open a fresh `onmouseover=` etc. The single-quote is
 * included for symmetry — some renderers / future code may use single
 * quotes around attributes. Maps:
 *   `&`  → `&amp;`
 *   `<`  → `&lt;`
 *   `>`  → `&gt;`
 *   `"`  → `&quot;`
 *   `'`  → `&#39;`
 *
 * NOTE: we deliberately do NOT escape `/`. The link's prefix-check regex
 * (`/^(https?:\/\/|\/|#)/`) is applied to the post-escape href; escaping
 * `/` would break that check for legitimate URLs (`https://...` would
 * become `https:&#x2F;&#x2F;...` and fail the prefix). Forward-slash is
 * not an attribute-context escape vector — it only matters in
 * `</script>` breakouts, which don't apply inside `dangerouslySetInnerHTML`
 * (the surrounding context is HTML, not JS).
 *
 * Regression test in `__tests__/markdown-card.xss.test.tsx` asserts that
 * a malicious markdown link with `"` in the URL cannot break out of the
 * href attribute. Keep these two in lock-step.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(line: string, citationIds: ReadonlySet<string>): string {
  let s = escapeHtml(line);
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code class="rounded bg-surface-sunken px-1 py-0.5 text-[11px]">$1</code>');
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // links [text](url) — sanitise URL.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
    if (!/^(https?:\/\/|\/|#)/.test(href)) return text;
    return `<a class="text-blue-600 underline" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`;
  });
  // citations [cite:id]
  s = s.replace(/\[cite:([a-zA-Z0-9_-]+)\]/g, (_m, id: string) => {
    if (!citationIds.has(id)) return `<sup class="text-muted-foreground">[?]</sup>`;
    return `<sup><a href="#cite-${escapeHtml(id)}" class="rounded bg-surface-sunken px-1 text-[10px] text-blue-600">[${escapeHtml(id)}]</a></sup>`;
  });
  return s;
}

interface Block {
  readonly tag: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'pre';
  readonly content: string;
  readonly items?: ReadonlyArray<string>;
}

function parseMarkdown(md: string): ReadonlyArray<Block> {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('### ')) {
      blocks.push({ tag: 'h3', content: line.slice(4) });
      i += 1;
    } else if (line.startsWith('## ')) {
      blocks.push({ tag: 'h2', content: line.slice(3) });
      i += 1;
    } else if (line.startsWith('# ')) {
      blocks.push({ tag: 'h1', content: line.slice(2) });
      i += 1;
    } else if (line.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push({ tag: 'pre', content: buf.join('\n') });
    } else if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ tag: 'ul', content: '', items });
    } else if (line.trim() === '') {
      i += 1;
    } else {
      // paragraph: consume until blank line.
      const buf: string[] = [line];
      i += 1;
      while (
        i < lines.length &&
        (lines[i] ?? '').trim() !== '' &&
        !/^([#`-]|\s*[-*]\s+)/.test(lines[i] ?? '')
      ) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      blocks.push({ tag: 'p', content: buf.join(' ') });
    }
  }
  return blocks;
}

export function MarkdownCard(props: MarkdownCardProps): JSX.Element {
  const parsed = MarkdownCardPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="markdown-card"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }

  const citationIds = useMemo(
    () => new Set((props.citations ?? []).map((c) => c.id)),
    [props.citations],
  );
  const blocks = useMemo(() => parseMarkdown(props.markdown), [props.markdown]);
  const sevClass = props.severity ? SEVERITY_CLASS[props.severity] ?? '' : '';

  return (
    <Frame kind="markdown-card" {...(props.title ? { title: props.title } : {})}>
      <div className={`prose-genui ${sevClass} pl-3`}>
        {blocks.map((b, i) => {
          if (b.tag === 'pre') {
            return (
              <pre key={i} className="my-2 overflow-x-auto rounded border border-border bg-surface-sunken p-2 text-[11px]">
                <code>{b.content}</code>
              </pre>
            );
          }
          if (b.tag === 'ul') {
            return (
              <ul key={i} className="my-1 list-disc pl-5 text-sm text-foreground">
                {(b.items ?? []).map((it, j) => (
                  <li
                    key={j}
                    dangerouslySetInnerHTML={{ __html: renderInline(it, citationIds) }}
                  />
                ))}
              </ul>
            );
          }
          const html = renderInline(b.content, citationIds);
          if (b.tag === 'h1') {
            return (
              <h1
                key={i}
                className="mt-2 text-lg font-semibold text-foreground"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          if (b.tag === 'h2') {
            return (
              <h2
                key={i}
                className="mt-2 text-base font-semibold text-foreground"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          if (b.tag === 'h3') {
            return (
              <h3
                key={i}
                className="mt-2 text-sm font-semibold text-foreground"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          return (
            <p
              key={i}
              className="my-1 text-sm text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        })}
      </div>
      {props.citations && props.citations.length > 0 ? (
        <div className="mt-3 border-t border-border pt-2 text-[11px]">
          <div className="mb-1 font-medium text-muted-foreground">Citations</div>
          <ol className="list-decimal pl-5 text-muted-foreground">
            {props.citations.map((c) => (
              <li key={c.id} id={`cite-${c.id}`}>
                {c.sourceUri ? (
                  <a
                    className="text-blue-600 underline"
                    href={c.sourceUri}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {c.label}
                  </a>
                ) : (
                  c.label
                )}
                {c.sourceRowRef ? (
                  <span className="ml-1 text-muted-foreground">({c.sourceRowRef})</span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Frame>
  );
}
