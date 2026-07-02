/**
 * Minimal, dependency-free markdown → safe HTML renderer.
 *
 * Handles the expressive-range subset a thoughtful Mr. Mwikila reply needs:
 * bold, italic, inline code, del/strikethrough, mark/highlight, kbd, links,
 * headings, bullet / ordered / task lists, GFM tables, blockquotes & callout
 * admonitions, and fenced (syntax-labelled) code blocks. Everything else falls
 * back to escaped text.
 *
 * SECURITY: every leaf of user/model content is routed through `escapeHtml`
 * before it lands in the output. No raw HTML tag from the input ever survives
 * (it is escaped to `&lt;…`), so the string is safe to feed a
 * `dangerouslySetInnerHTML` consumer even though this module emits its own
 * trusted tag skeleton. STRUCTURE (tables / lists / callouts) is
 * locale-agnostic; the CONTENT it wraps stays whatever single locale the model
 * emitted.
 *
 * STREAMING DISCIPLINE (settle-parse): the renderer is line-oriented and never
 * throws on a partial document. An unterminated code fence, a half-typed table,
 * or a lone callout marker mid-stream renders as a graceful in-progress block
 * (or plain prose) and promotes to its final form once the closing tokens
 * arrive on a later coalesced frame — never a crash, never mis-rendered markup.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline-span pass. Ordering matters: code first (its content must not be
 * re-parsed for emphasis), then the paired-delimiter emphasis devices, then
 * links. `kbd` uses a distinct `[[key]]` sentinel so it never collides with
 * link syntax `[text](url)`.
 */
function inline(text: string): string {
  let out = escapeHtml(text);
  // Inline code — content is already escaped; emphasis inside is intentionally
  // NOT re-parsed (code is literal).
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="borjie-md-code">$1</code>',
  );
  // kbd — [[Ctrl]] renders a keycap. Declared before links so `[[` is not
  // mistaken for a link label.
  out = out.replace(
    /\[\[([^\]]+)\]\]/g,
    '<kbd class="borjie-md-kbd">$1</kbd>',
  );
  // Bold, then italic (bold's `**` consumed first so a lone `*` inside stays).
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Strikethrough (GFM ~~del~~).
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Highlight (==mark==).
  out = out.replace(
    /==([^=]+)==/g,
    '<mark class="borjie-md-mark">$1</mark>',
  );
  // Links — http(s) only, opened safely in a new tab.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return out;
}

// -----------------------------------------------------------------------------
// Callout / admonition support ( > [!NOTE] / [!WARNING] / [!TIP] / [!CAUTION] )
// -----------------------------------------------------------------------------

const CALLOUT_KINDS: Readonly<Record<string, string>> = {
  NOTE: 'borjie-md-callout--note',
  TIP: 'borjie-md-callout--tip',
  IMPORTANT: 'borjie-md-callout--important',
  WARNING: 'borjie-md-callout--warning',
  CAUTION: 'borjie-md-callout--caution',
};

function calloutClass(kind: string): string {
  return CALLOUT_KINDS[kind.toUpperCase()] ?? 'borjie-md-callout--note';
}

// -----------------------------------------------------------------------------
// Table support (GFM pipe tables)
// -----------------------------------------------------------------------------

/** A separator row is `| --- | :--: | ---: |` — dashes with optional colons. */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  if (!trimmed.includes('-')) return false;
  return trimmed
    .split('|')
    .every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell));
}

/** Split a `| a | b |` row into trimmed cell strings, tolerating edge pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Column alignment from a separator cell (`:--`, `--:`, `:-:`). */
function alignOf(cell: string): string {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return ' style="text-align:center"';
  if (right) return ' style="text-align:right"';
  if (left) return ' style="text-align:left"';
  return '';
}

function renderTable(header: string, separator: string, bodyRows: string[]): string {
  const heads = splitRow(header);
  const aligns = splitRow(separator).map(alignOf);
  const thead = heads
    .map((cell, i) => `<th${aligns[i] ?? ''}>${inline(cell)}</th>`)
    .join('');
  const tbody = bodyRows
    .map((row) => {
      const cells = splitRow(row);
      const tds = heads
        .map((_, i) => `<td${aligns[i] ?? ''}>${inline(cells[i] ?? '')}</td>`)
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `<div class="borjie-md-tablewrap"><table class="borjie-md-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

// -----------------------------------------------------------------------------
// Task-list support ( - [ ] / - [x] )
// -----------------------------------------------------------------------------

const TASK_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/;

function renderTaskItem(match: RegExpExecArray): string {
  const checked = match[1] !== ' ';
  const box = checked
    ? '<input type="checkbox" checked disabled class="borjie-md-task">'
    : '<input type="checkbox" disabled class="borjie-md-task">';
  return `<li class="borjie-md-taskitem">${box}<span>${inline(match[2] ?? '')}</span></li>`;
}

// -----------------------------------------------------------------------------
// Main renderer
// -----------------------------------------------------------------------------

interface BlockState {
  inUl: boolean;
  inOl: boolean;
  inTaskList: boolean;
}

export function renderMarkdown(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  const state: BlockState = { inUl: false, inOl: false, inTaskList: false };

  const closeLists = (): void => {
    if (state.inUl) {
      out.push('</ul>');
      state.inUl = false;
    }
    if (state.inOl) {
      out.push('</ol>');
      state.inOl = false;
    }
    if (state.inTaskList) {
      out.push('</ul>');
      state.inTaskList = false;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').replace(/\r$/, '');

    // Fenced code block — ```lang … ```. A missing closing fence (mid-stream)
    // still renders every line collected so far, then stops cleanly at EOF.
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      closeLists();
      const lang = fence[1] ?? '';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        codeLines.push((lines[i] ?? '').replace(/\r$/, ''));
        i += 1;
      }
      // Skip the closing fence if present; at EOF (unterminated) i === length.
      if (i < lines.length) i += 1;
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      const body = codeLines.map((l) => escapeHtml(l)).join('\n');
      out.push(
        `<pre class="borjie-md-pre"${langAttr}><code>${body}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i += 1;
      continue;
    }

    // Callout / blockquote admonition — > [!WARNING] title … . Collect the
    // contiguous `>`-prefixed block; a lone/partial marker mid-stream renders
    // as a plain blockquote until the block completes.
    if (/^>\s?/.test(line)) {
      closeLists();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').replace(/\r$/, ''))) {
        quoteLines.push((lines[i] ?? '').replace(/\r$/, '').replace(/^>\s?/, ''));
        i += 1;
      }
      const first = quoteLines[0] ?? '';
      const marker = /^\[!(\w+)\]\s*(.*)$/.exec(first);
      if (marker) {
        const cls = calloutClass(marker[1] ?? '');
        const title = (marker[2] ?? '').trim();
        const rest = quoteLines.slice(1).filter((l) => l.trim());
        const titleHtml = title
          ? `<p class="borjie-md-callout__title">${inline(title)}</p>`
          : `<p class="borjie-md-callout__title">${escapeHtml((marker[1] ?? '').toUpperCase())}</p>`;
        const bodyHtml = rest.map((l) => `<p>${inline(l)}</p>`).join('');
        out.push(
          `<div class="borjie-md-callout ${cls}">${titleHtml}${bodyHtml}</div>`,
        );
      } else {
        const bodyHtml = quoteLines
          .filter((l) => l.trim())
          .map((l) => `<p>${inline(l)}</p>`)
          .join('');
        out.push(`<blockquote class="borjie-md-quote">${bodyHtml}</blockquote>`);
      }
      continue;
    }

    // GFM table — header row followed by a separator row.
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator((lines[i + 1] ?? '').replace(/\r$/, ''))
    ) {
      closeLists();
      const header = line;
      const separator = (lines[i + 1] ?? '').replace(/\r$/, '');
      i += 2;
      const bodyRows: string[] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').replace(/\r$/, '').trim().includes('|') &&
        (lines[i] ?? '').replace(/\r$/, '').trim() !== ''
      ) {
        bodyRows.push((lines[i] ?? '').replace(/\r$/, ''));
        i += 1;
      }
      out.push(renderTable(header, separator, bodyRows));
      continue;
    }

    // Headings.
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h && h[1] && h[2] !== undefined) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Task-list items ( - [ ] / - [x] ) — checked before plain bullets.
    const task = TASK_RE.exec(line);
    if (task) {
      if (!state.inTaskList) {
        closeLists();
        out.push('<ul class="borjie-md-tasklist">');
        state.inTaskList = true;
      }
      out.push(renderTaskItem(task));
      i += 1;
      continue;
    }

    // Bullet list.
    if (/^[-*]\s+/.test(line)) {
      if (!state.inUl) {
        closeLists();
        out.push('<ul>');
        state.inUl = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(line)) {
      if (!state.inOl) {
        closeLists();
        out.push('<ol>');
        state.inOl = true;
      }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      i += 1;
      continue;
    }

    // Paragraph fallback.
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
    i += 1;
  }

  closeLists();
  return out.join('');
}
