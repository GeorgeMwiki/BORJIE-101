/**
 * Structural diff between two {@link AxTreeSnapshot}s.
 *
 * Token-cheap by design: we emit `{added, removed, changed}` node lists
 * keyed by a stable `(role, name, depth, indexInParent)` path, NOT a
 * pixel-level patch. The brain reads the diff to decide whether the
 * post-action page state matches expectations.
 */

import {
  flattenAxNodes,
  type AxNode,
  type AxTreeSnapshot,
} from './axtree-snapshot.js';

export interface AxDiffEntry {
  /** Stable identity: `${role}::${normalisedName}::${path}`. */
  readonly key: string;
  readonly role: string;
  readonly name: string;
  readonly path: string;
}

export interface AxChangedEntry extends AxDiffEntry {
  readonly fields: ReadonlyArray<keyof AxNode>;
  readonly before: Partial<AxNode>;
  readonly after: Partial<AxNode>;
}

export interface AxTreeDiff {
  readonly added: AxDiffEntry[];
  readonly removed: AxDiffEntry[];
  readonly changed: AxChangedEntry[];
  /** True iff `added.length + removed.length + changed.length === 0`. */
  readonly identical: boolean;
}

function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

type Indexed = {
  readonly key: string;
  readonly role: string;
  readonly name: string;
  readonly path: string;
  readonly node: AxNode;
};

function indexTree(root: AxNode | null): Map<string, Indexed> {
  const out = new Map<string, Indexed>();
  if (!root) return out;
  const walk = (node: AxNode, path: string): void => {
    const key = `${node.role}::${normaliseName(node.name ?? '')}::${path}`;
    out.set(key, {
      key,
      role: node.role,
      name: node.name ?? '',
      path,
      node,
    });
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child) walk(child, `${path}/${i}`);
    }
  };
  walk(root, '0');
  return out;
}

const COMPARED_FIELDS: ReadonlyArray<keyof AxNode> = [
  'value',
  'focused',
  'disabled',
  'checked',
  'selected',
];

function diffNodes(
  before: AxNode,
  after: AxNode,
): { changed: boolean; fields: Array<keyof AxNode> } {
  const fields: Array<keyof AxNode> = [];
  for (const f of COMPARED_FIELDS) {
    const b = before[f];
    const a = after[f];
    if (b !== a) fields.push(f);
  }
  return { changed: fields.length > 0, fields };
}

/**
 * Compute the structural diff. Both snapshots can be the result of
 * {@link captureAxTreeSnapshot}; null roots are allowed.
 */
export function diffAxSnapshots(
  before: AxTreeSnapshot | null,
  after: AxTreeSnapshot | null,
): AxTreeDiff {
  const beforeIdx = indexTree(before?.root ?? null);
  const afterIdx = indexTree(after?.root ?? null);

  const added: AxDiffEntry[] = [];
  const removed: AxDiffEntry[] = [];
  const changed: AxChangedEntry[] = [];

  for (const [key, entry] of afterIdx) {
    if (!beforeIdx.has(key)) {
      added.push({
        key,
        role: entry.role,
        name: entry.name,
        path: entry.path,
      });
    }
  }

  for (const [key, entry] of beforeIdx) {
    if (!afterIdx.has(key)) {
      removed.push({
        key,
        role: entry.role,
        name: entry.name,
        path: entry.path,
      });
      continue;
    }
    const otherEntry = afterIdx.get(key);
    if (!otherEntry) continue;
    const { changed: didChange, fields } = diffNodes(
      entry.node,
      otherEntry.node,
    );
    if (didChange) {
      const beforeFields: Partial<AxNode> = {};
      const afterFields: Partial<AxNode> = {};
      for (const f of fields) {
        const bVal = entry.node[f];
        const aVal = otherEntry.node[f];
        if (bVal !== undefined) (beforeFields as Record<string, unknown>)[f] = bVal;
        if (aVal !== undefined) (afterFields as Record<string, unknown>)[f] = aVal;
      }
      changed.push({
        key,
        role: entry.role,
        name: entry.name,
        path: entry.path,
        fields,
        before: beforeFields,
        after: afterFields,
      });
    }
  }

  return {
    added,
    removed,
    changed,
    identical:
      added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

/** Convenience: number of distinct change buckets. */
export function diffSize(diff: AxTreeDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length;
}

/**
 * Has a node matching `(role, namePattern)` appeared in `after`? Used by
 * `legacyPortalDriver.act` to confirm the post-action state.
 */
export function diffContainsAdded(
  diff: AxTreeDiff,
  role: string,
  namePattern: RegExp,
): boolean {
  return diff.added.some(
    (e) => e.role === role && namePattern.test(e.name ?? ''),
  );
}

// Re-export the snapshot helper for convenience.
export { flattenAxNodes };
