/**
 * Tiny TOML reader/writer for the CLI's user config.
 *
 * We deliberately ship a hand-rolled flat-table parser instead of
 * `@iarna/toml` so the CLI has zero runtime deps for its config layer.
 * Supports the subset Borjie's config.toml needs:
 *
 *   key = "string"
 *   key = true | false
 *   key = 42
 *   # comments
 *   [section]
 *
 * Anything fancier (arrays of tables, dotted keys, datetimes) is out of
 * scope — and rejected with a clear error.
 */

export type TomlValue = string | number | boolean;
export type TomlTable = Readonly<Record<string, TomlValue>>;
export type TomlDoc = Readonly<Record<string, TomlTable>>;

export function parseToml(input: string): TomlDoc {
  const out: Record<string, Record<string, TomlValue>> = { _: {} };
  let section = '_';
  let lineNo = 0;
  for (const rawLine of input.split(/\r?\n/)) {
    lineNo += 1;
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
        throw new Error(`Invalid section name on line ${lineNo}: ${name}`);
      }
      section = name;
      if (!out[section]) out[section] = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) {
      throw new Error(`Expected key = value on line ${lineNo}`);
    }
    const key = line.slice(0, eq).trim();
    const valueRaw = line.slice(eq + 1).trim();
    if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
      throw new Error(`Invalid key on line ${lineNo}: ${key}`);
    }
    const value = parseValue(valueRaw, lineNo);
    const target = out[section];
    if (!target) {
      throw new Error(`Internal: missing section "${section}"`);
    }
    target[key] = value;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, Object.freeze({ ...v })]),
    ),
  ) as TomlDoc;
}

export function stringifyToml(doc: TomlDoc): string {
  const parts: string[] = [];
  const rootEntries = Object.entries(doc._ ?? {});
  if (rootEntries.length > 0) {
    for (const [k, v] of rootEntries) {
      parts.push(`${k} = ${formatValue(v)}`);
    }
    parts.push('');
  }
  for (const [section, table] of Object.entries(doc)) {
    if (section === '_') continue;
    parts.push(`[${section}]`);
    for (const [k, v] of Object.entries(table)) {
      parts.push(`${k} = ${formatValue(v)}`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    else if (ch === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw: string, lineNo: number): TomlValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  const num = Number(raw);
  if (Number.isFinite(num) && raw.length > 0 && !raw.includes(' ')) return num;
  throw new Error(`Unsupported value on line ${lineNo}: ${raw}`);
}

function formatValue(v: TomlValue): string {
  if (typeof v === 'string') {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return String(v);
}
