/**
 * Accessibility-tree snapshot from a Playwright `Page`.
 *
 * Central Command Phase B B6 — the brain's "visual cortex" for legacy
 * vendor portals (KRA iTax, GePG, etc.) is the a11y tree, NOT the
 * raw DOM. Vercel's agent-browser benchmark shows ~93% token savings
 * (raw DOM → a11y tree) on real e-commerce + government sites.
 *
 * Caps (intentionally aggressive — mirror C4's sensorium a11y caps):
 *   - depth ≤ {@link DEFAULT_MAX_DEPTH}
 *   - total nodes ≤ {@link DEFAULT_MAX_NODES}
 *
 * Filters:
 *   - skip nodes with `ignored === true` OR `aria-hidden`
 *   - prune subtrees with no `name` AND no actionable role
 *   - DON'T emit the literal text "text" — Playwright's accessibility
 *     snapshot uses that placeholder for inline text runs; we keep
 *     the run only if `name` is non-empty.
 */

export const DEFAULT_MAX_DEPTH = 12;
export const DEFAULT_MAX_NODES = 200;

/** Roles a brain may want to interact with even when `name` is empty. */
const ACTIONABLE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'tab',
  'option',
  'slider',
  'spinbutton',
]);

export interface AxNode {
  readonly role: string;
  readonly name: string;
  readonly value?: string;
  readonly focused?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly selected?: boolean;
  readonly children?: AxNode[];
}

export interface AxTreeSnapshot {
  readonly capturedAt: string;
  readonly url?: string;
  readonly nodeCount: number;
  readonly truncated: boolean;
  readonly root: AxNode | null;
}

/** Minimal Playwright `Page` surface we depend on. */
export interface PlaywrightPageLike {
  url?: () => string;
  accessibility: {
    snapshot: (opts?: {
      interestingOnly?: boolean;
      root?: unknown;
    }) => Promise<RawAxNode | null>;
  };
}

/**
 * Playwright's snapshot has this shape (excerpted from playwright-core
 * `AXNode.serialize`). We don't import the type to keep this package
 * compiling without a Playwright install.
 */
export interface RawAxNode {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  ignored?: boolean;
  children?: RawAxNode[];
}

export interface SnapshotOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  /** Pass `false` to keep `interestingOnly: false` upstream (rare). */
  readonly interestingOnly?: boolean;
}

interface BuildContext {
  budget: number;
  truncated: boolean;
}

function isHidden(raw: RawAxNode): boolean {
  if (raw.ignored === true) return true;
  if (raw.role === 'none' || raw.role === 'presentation') return true;
  return false;
}

function isInteresting(raw: RawAxNode): boolean {
  if (ACTIONABLE_ROLES.has(raw.role)) return true;
  if (raw.name && raw.name.trim().length > 0) return true;
  if (raw.value !== undefined && String(raw.value).length > 0) return true;
  return false;
}

function trim(node: RawAxNode, depth: number, max: number, ctx: BuildContext): AxNode | null {
  if (isHidden(node)) return null;
  if (depth > max) {
    ctx.truncated = true;
    return null;
  }
  if (ctx.budget <= 0) {
    ctx.truncated = true;
    return null;
  }

  // Process children first so we can prune empty subtrees AFTER we
  // know whether the children added anything actionable.
  const childOut: AxNode[] = [];
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const built = trim(child, depth + 1, max, ctx);
      if (built) childOut.push(built);
    }
  }

  const hasInterestingChild = childOut.length > 0;
  if (!isInteresting(node) && !hasInterestingChild) {
    return null;
  }

  // Re-check budget AFTER processing children. Children may have consumed
  // the entire budget; including this parent here would push `nodeCount`
  // past `maxNodes`. We mark truncated and drop the parent, but keep the
  // children we already accumulated (they're already counted against the
  // budget so the math stays honest).
  if (ctx.budget <= 0) {
    ctx.truncated = true;
    return null;
  }

  ctx.budget -= 1;

  const out: AxNode = {
    role: node.role,
    name: (node.name ?? '').trim(),
    ...(node.value !== undefined ? { value: String(node.value) } : {}),
    ...(node.focused !== undefined ? { focused: node.focused } : {}),
    ...(node.disabled !== undefined ? { disabled: node.disabled } : {}),
    ...(node.checked !== undefined ? { checked: node.checked } : {}),
    ...(node.selected !== undefined ? { selected: node.selected } : {}),
    ...(childOut.length > 0 ? { children: childOut } : {}),
  };
  return out;
}

/**
 * Capture a token-cheap a11y-tree snapshot from a Playwright page. Caller
 * controls the page lifecycle; this never closes anything.
 */
export async function captureAxTreeSnapshot(
  page: PlaywrightPageLike,
  opts: SnapshotOptions = {},
): Promise<AxTreeSnapshot> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const interestingOnly = opts.interestingOnly ?? true;

  const raw = await page.accessibility.snapshot({ interestingOnly });
  const ctx: BuildContext = { budget: maxNodes, truncated: false };

  let root: AxNode | null = null;
  if (raw) {
    root = trim(raw, 0, maxDepth, ctx);
  }

  const nodeCount = maxNodes - ctx.budget;
  let url: string | undefined;
  try {
    url = page.url?.();
  } catch {
    url = undefined;
  }

  return {
    capturedAt: new Date().toISOString(),
    ...(url !== undefined ? { url } : {}),
    nodeCount,
    truncated: ctx.truncated,
    root,
  };
}

/**
 * Flatten an `AxNode` tree to a list with `(role, name)` tuples. Used by
 * the driver's `findRoleByName` and the diff module.
 */
export function flattenAxNodes(root: AxNode | null): AxNode[] {
  if (!root) return [];
  const out: AxNode[] = [];
  const stack: AxNode[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    out.push(node);
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  return out;
}
