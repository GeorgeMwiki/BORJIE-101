/**
 * Accessibility tree snapshot — Central Command Phase A (C4 Brain Skin).
 *
 * Walks `document.documentElement` to build a SPARSE accessibility
 * tree that the brain reads as its "visual cortex". Per the research
 * notes (Vercel agent-browser, Playwright MCP, Chrome DevTools MCP,
 * Stagehand 2.0), this is ~93% smaller than the full DOM in token
 * terms — the load-bearing perception substrate for 2025-26 agents.
 *
 * Caps:
 *   - max depth 12
 *   - max 200 nodes total
 *   - node `name` truncated to 80 chars
 *
 * Hidden / off-screen / aria-hidden subtrees are skipped at the
 * walk boundary — we never recurse into them.
 */

export const A11Y_MAX_DEPTH = 12;
export const A11Y_MAX_NODES = 200;
export const A11Y_NAME_MAX = 80;

export interface A11yNode {
  readonly role: string;
  readonly name?: string;
  readonly level?: number;
  readonly focused?: boolean;
  readonly expanded?: boolean;
  readonly value?: string;
  readonly children?: ReadonlyArray<A11yNode>;
}

export interface A11ySnapshot {
  readonly root: A11yNode;
  readonly nodeCount: number;
  readonly digest: string;
  readonly capturedAt: number;
  readonly visibleRoles: ReadonlyArray<string>;
  readonly focusedRole?: string;
}

/**
 * Build a snapshot from a root element (defaults to `document.body`).
 *
 * Safe to call from any rendering context — when the DOM is not
 * available (SSR), returns an empty stub snapshot rather than
 * throwing.
 */
export function snapshotA11yTree(
  root?: Element | null,
  options: { maxDepth?: number; maxNodes?: number } = {},
): A11ySnapshot {
  const maxDepth = options.maxDepth ?? A11Y_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? A11Y_MAX_NODES;

  if (typeof document === 'undefined') {
    return emptySnapshot();
  }
  const start = root ?? document.body ?? null;
  if (!start) return emptySnapshot();

  const counter = { remaining: maxNodes };
  const visibleRoles = new Set<string>();
  let focusedRole: string | undefined;

  const rootNode = walk(start, 0, maxDepth, counter, (n) => {
    visibleRoles.add(n.role);
    if (n.focused) focusedRole = n.role;
  });

  const finalRoot: A11yNode = rootNode ?? { role: 'unknown' };
  const nodeCount = maxNodes - counter.remaining;
  return {
    root: finalRoot,
    nodeCount,
    digest: cheapDigest(finalRoot),
    capturedAt: Date.now(),
    visibleRoles: [...visibleRoles],
    ...(focusedRole !== undefined ? { focusedRole } : {}),
  };
}

function emptySnapshot(): A11ySnapshot {
  return {
    root: { role: 'document' },
    nodeCount: 0,
    digest: '0',
    capturedAt: Date.now(),
    visibleRoles: [],
  };
}

function walk(
  el: Element,
  depth: number,
  maxDepth: number,
  counter: { remaining: number },
  onNode: (n: A11yNode) => void,
): A11yNode | null {
  if (counter.remaining <= 0) return null;
  if (!isVisible(el)) return null;

  counter.remaining -= 1;
  const role = inferRole(el);
  const name = inferName(el);
  const level = inferLevel(el);
  const focused = isFocused(el);
  const expanded = inferExpanded(el);
  const value = inferValue(el);

  const children: A11yNode[] = [];
  if (depth + 1 < maxDepth) {
    for (const child of Array.from(el.children)) {
      const childNode = walk(child, depth + 1, maxDepth, counter, onNode);
      if (childNode) children.push(childNode);
      if (counter.remaining <= 0) break;
    }
  }

  const node: A11yNode = {
    role,
    ...(name ? { name } : {}),
    ...(level ? { level } : {}),
    ...(focused ? { focused: true } : {}),
    ...(expanded !== undefined ? { expanded } : {}),
    ...(value ? { value } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
  onNode(node);
  return node;
}

function isVisible(el: Element): boolean {
  if (!el) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.getAttribute('hidden') !== null) return false;
  // Only inspect computed style when the helper is available — jsdom
  // sometimes omits it and we'd rather over-include than throw.
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    } catch {
      // Ignore — fall through to "visible".
    }
  }
  return true;
}

function inferRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input': {
      const inputType = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (inputType === 'checkbox') return 'checkbox';
      if (inputType === 'radio') return 'radio';
      if (inputType === 'submit' || inputType === 'button') return 'button';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'form':
      return 'form';
    case 'dialog':
      return 'dialog';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'img':
      return 'img';
    case 'label':
      return 'label';
    case 'section':
      return 'region';
    case 'article':
      return 'article';
    default:
      return tag;
  }
}

function inferName(el: Element): string | undefined {
  const label =
    el.getAttribute('aria-label') ??
    el.getAttribute('alt') ??
    el.getAttribute('title') ??
    el.getAttribute('placeholder');
  if (label) return truncateName(label);
  // For text-only leaves, use the trimmed textContent.
  if (
    !el.children.length &&
    typeof el.textContent === 'string' &&
    el.textContent.trim().length > 0
  ) {
    return truncateName(el.textContent.trim());
  }
  return undefined;
}

function inferLevel(el: Element): number | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag.length === 2 && tag[0] === 'h') {
    const n = Number.parseInt(tag.slice(1), 10);
    if (Number.isFinite(n)) return n;
  }
  const explicit = el.getAttribute('aria-level');
  if (explicit) {
    const n = Number.parseInt(explicit, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isFocused(el: Element): boolean {
  try {
    return typeof document !== 'undefined' && document.activeElement === el;
  } catch {
    return false;
  }
}

function inferExpanded(el: Element): boolean | undefined {
  const v = el.getAttribute('aria-expanded');
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function inferValue(el: Element): string | undefined {
  if (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ) {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    // NEVER expose sensitive values.
    if (type === 'password' || type === 'cc' || type === 'credit') {
      return undefined;
    }
    const raw = (el as HTMLInputElement).value;
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= 40) {
      return truncateName(raw);
    }
  }
  return undefined;
}

function truncateName(s: string): string {
  if (s.length <= A11Y_NAME_MAX) return s;
  return `${s.slice(0, A11Y_NAME_MAX - 1)}…`;
}

/**
 * Tiny non-crypto digest. Good enough as a cache-key buster — we
 * recompute the snapshot when the digest changes, not when DOM
 * timestamps tick.
 */
function cheapDigest(node: A11yNode): string {
  let hash = 5381;
  function fold(n: A11yNode): void {
    hash = (hash * 33) ^ stringHash(n.role);
    if (n.name) hash = (hash * 33) ^ stringHash(n.name);
    if (n.focused) hash = (hash * 33) ^ 7;
    if (n.expanded) hash = (hash * 33) ^ 11;
    if (n.children) for (const c of n.children) fold(c);
  }
  fold(node);
  return (hash >>> 0).toString(36);
}

function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}
