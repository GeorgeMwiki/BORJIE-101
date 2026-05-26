/**
 * Minimal YAML emitter for the mining OpenAPI spec.
 *
 * Avoids a js-yaml dependency. Same impl as the original Option B
 * generator — preserved here so the spec output stays byte-stable
 * across the migration.
 */

function yamlKey(k: string): string {
  if (/^[A-Za-z0-9_./{}-]+$/.test(k)) return k;
  return `"${k.replace(/"/g, '\\"')}"`;
}

function yamlString(s: string): string {
  if (s.includes('\n')) {
    const indent = '  ';
    const folded = s
      .split('\n')
      .map((line) => `${indent}${line}`)
      .join('\n');
    return `|\n${folded}`;
  }
  const needsQuote =
    /^[\s\-?:,\[\]{}#&*!|>%@`'"]/.test(s) ||
    /[:#]/.test(s) ||
    /[\s]$/.test(s) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s);
  if (!needsQuote) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return yamlString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        if (typeof item === 'object' && item !== null) {
          const trimmed = rendered.replace(/^\s+/, '');
          return `${pad}- ${trimmed}`;
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    return keys
      .map((k, idx) => {
        const v = obj[k];
        const safeKey = yamlKey(k);
        const isObj = v !== null && typeof v === 'object';
        if (isObj && !Array.isArray(v) && Object.keys(v as object).length === 0) {
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: {}`;
        }
        if (Array.isArray(v) && v.length === 0) {
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: []`;
        }
        if (isObj) {
          const rendered = toYaml(v, indent + 1);
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}:\n${rendered}`;
        }
        return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: ${toYaml(v, indent + 1)}`;
      })
      .join('\n');
  }
  return JSON.stringify(value);
}
