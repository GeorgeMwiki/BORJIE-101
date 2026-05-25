/**
 * Minimal YAML-frontmatter parser tuned to the Claude Code
 * `.claude/<thing>.md` contract — flat keys + scalar / list values.
 *
 * We intentionally do NOT pull in `gray-matter` / `js-yaml`; the
 * grammar is tiny, the dependency surface is large, and we never
 * need nested maps for skills / commands / agents.
 *
 * Supported shapes:
 *
 *   ---
 *   name: foo                    # scalar (string)
 *   description: "Has: colons"   # quoted scalar
 *   tools: Read, Write, Edit     # comma list
 *   allowed-tools:               # JSON-array list
 *     - Read
 *     - Edit
 *   disable-model-invocation: true   # boolean
 *   max-turns: 5                     # number
 *   ---
 *
 *   <body…>
 */

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export interface ParsedFrontmatter {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/**
 * Parse a markdown source. If no frontmatter is present, returns
 * an empty `data` map and the original source as `body`. Never
 * throws — bad YAML degrades to "string value of the raw line".
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    return { data: Object.freeze({}), body: source };
  }
  const [, yaml, body] = match;
  const data: Record<string, unknown> = {};
  const lines = (yaml ?? '').split(/\r?\n/);
  let pendingListKey: string | null = null;
  let pendingList: string[] = [];

  const flushList = (): void => {
    if (pendingListKey !== null) {
      data[pendingListKey] = pendingList;
      pendingListKey = null;
      pendingList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('- ')) {
      if (pendingListKey === null) {
        // Orphan list item — treat as a single anon entry under `_items`.
        const bucket = (data['_items'] as string[] | undefined) ?? [];
        bucket.push(stripQuotes(line.slice(2).trim()));
        data['_items'] = bucket;
      } else {
        pendingList.push(stripQuotes(line.slice(2).trim()));
      }
      continue;
    }
    flushList();
    const idx = line.indexOf(':');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (rawValue.length === 0) {
      // Empty value — start a list buffer.
      pendingListKey = key;
      pendingList = [];
      continue;
    }
    data[key] = coerce(rawValue);
  }
  flushList();

  return { data: Object.freeze(data), body: (body ?? '').trim() };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Coerces a raw frontmatter scalar to a typed value.
 *
 * IMPORTANT: we do NOT auto-split comma-separated strings here. A
 * value like `description: Use when adding auth, handling input, …`
 * would otherwise become an array, but `description` is a string per
 * the Claude Agent SDK contract. Callers that want list semantics
 * use `asStringList(value)` explicitly.
 */
function coerce(value: string): unknown {
  const stripped = stripQuotes(value);
  if (stripped !== value) {
    // Quoted — always a string.
    return stripped;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  return value;
}

/**
 * Normalise a frontmatter list-shaped field into `ReadonlyArray<string>`.
 * Accepts:
 *   - a literal array        (`['Read', 'Write']`)
 *   - a comma-separated str  (`'Read, Write'`)
 *   - a single string scalar (`'Read'`)
 *   - undefined / null       (`undefined`)
 */
export function asStringList(value: unknown): ReadonlyArray<string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
  }
  return [String(value)];
}
