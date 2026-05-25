/**
 * SKILL.md parser. The frontmatter is a YAML-ish (minimal subset) block
 * delimited by `---` lines at the top of the file. We do NOT pull in a
 * full YAML lib (zero-dep parser kept tiny + auditable for this format).
 *
 * Supported types: string, boolean, number, string-array.
 *
 * Example:
 *   ---
 *   name: handle-late-rent
 *   description: Walk a late-rent ticket through grace -> notice -> escalation.
 *   when_to_use:
 *     - tenant 5+ days late
 *     - missed rent reminder
 *   allowed_tools: [Read, Write]
 *   jurisdiction_aware: true
 *   code_entrypoint: ./handle-late-rent.skill.ts
 *   ---
 */

import type { SkillManifest } from './types.js';

const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;

interface ParsedFrontmatter {
  readonly raw: Record<string, unknown>;
  readonly body: string;
}

export class SkillManifestParseError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(`[skill-manifest] ${message} (in ${path})`);
  }
}

/**
 * Split frontmatter from body. Returns parsed frontmatter as a flat
 * `Record<string, unknown>` and the remaining markdown body.
 */
export function splitFrontmatter(source: string, path: string): ParsedFrontmatter {
  if (!source.startsWith('---')) {
    throw new SkillManifestParseError(
      'SKILL.md must begin with a YAML frontmatter block ("---" line)',
      path
    );
  }
  // Find the closing fence
  const lines = source.split('\n');
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new SkillManifestParseError(
      'SKILL.md frontmatter is not closed with a "---" line',
      path
    );
  }
  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join('\n').trim();
  const raw = parseMinimalYaml(fmLines, path);
  return { raw, body };
}

/**
 * Tiny YAML subset parser. Handles:
 *   key: value         (string/bool/number)
 *   key: [a, b, c]     (inline array)
 *   key:               (block array follows)
 *     - item1
 *     - item2
 */
function parseMinimalYaml(
  lines: ReadonlyArray<string>,
  path: string
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      throw new SkillManifestParseError(
        `frontmatter line missing colon: "${trimmed}"`,
        path
      );
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (rest === '') {
      // Block array follows: collect subsequent indented `-` lines.
      const arr: Array<string> = [];
      i++;
      while (i < lines.length) {
        const cont = lines[i];
        if (cont === undefined) {
          i++;
          continue;
        }
        const contTrim = cont.trim();
        if (contTrim.startsWith('-')) {
          arr.push(stripQuotes(contTrim.slice(1).trim()));
          i++;
        } else if (contTrim === '') {
          i++;
        } else {
          break;
        }
      }
      out[key] = arr;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      // Inline array
      const inner = rest.slice(1, -1).trim();
      if (inner === '') {
        out[key] = [];
      } else {
        out[key] = inner.split(',').map((s) => stripQuotes(s.trim()));
      }
      i++;
    } else {
      out[key] = coerceScalar(stripQuotes(rest));
      i++;
    }
  }
  return out;
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

/**
 * Validate + type-narrow a raw frontmatter dict to a SkillManifest.
 */
export function toSkillManifest(
  raw: Record<string, unknown>,
  path: string
): SkillManifest {
  const name = getString(raw, 'name', path);
  if (!SLUG_RE.test(name)) {
    throw new SkillManifestParseError(
      `name "${name}" must match /^[a-z][a-z0-9_-]{1,63}$/`,
      path
    );
  }
  const description = getString(raw, 'description', path);
  const when_to_use = getStringArray(raw, 'when_to_use', path);
  if (when_to_use.length === 0) {
    throw new SkillManifestParseError(
      'when_to_use must include at least one cue',
      path
    );
  }
  const allowed_tools = getStringArray(raw, 'allowed_tools', path);
  if (allowed_tools.length === 0) {
    throw new SkillManifestParseError(
      'allowed_tools cannot be empty (use ["Read"] for read-only)',
      path
    );
  }
  for (const tool of allowed_tools) {
    if (tool === 'Agent' || tool === 'Task') {
      throw new SkillManifestParseError(
        `skill cannot grant "${tool}" — skills are not subagents`,
        path
      );
    }
  }
  const jurisdiction_aware = getBoolean(raw, 'jurisdiction_aware', path);
  const code_entrypoint = getOptionalString(raw, 'code_entrypoint');
  if (code_entrypoint !== undefined) {
    if (code_entrypoint.includes('..')) {
      throw new SkillManifestParseError(
        `code_entrypoint "${code_entrypoint}" cannot contain ".." (must stay inside skill dir)`,
        path
      );
    }
  }
  const version = getOptionalString(raw, 'version');

  const manifest: SkillManifest = code_entrypoint !== undefined
    ? version !== undefined
      ? {
          name,
          description,
          when_to_use,
          allowed_tools,
          jurisdiction_aware,
          code_entrypoint,
          version,
        }
      : {
          name,
          description,
          when_to_use,
          allowed_tools,
          jurisdiction_aware,
          code_entrypoint,
        }
    : version !== undefined
      ? {
          name,
          description,
          when_to_use,
          allowed_tools,
          jurisdiction_aware,
          version,
        }
      : {
          name,
          description,
          when_to_use,
          allowed_tools,
          jurisdiction_aware,
        };
  return manifest;
}

function getString(raw: Record<string, unknown>, key: string, path: string): string {
  const v = raw[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new SkillManifestParseError(`"${key}" must be a non-empty string`, path);
  }
  return v;
}

function getOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return undefined;
  return v;
}

function getBoolean(raw: Record<string, unknown>, key: string, path: string): boolean {
  const v = raw[key];
  if (typeof v !== 'boolean') {
    throw new SkillManifestParseError(`"${key}" must be a boolean`, path);
  }
  return v;
}

function getStringArray(
  raw: Record<string, unknown>,
  key: string,
  path: string
): ReadonlyArray<string> {
  const v = raw[key];
  if (!Array.isArray(v)) {
    throw new SkillManifestParseError(`"${key}" must be a list`, path);
  }
  for (const item of v) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new SkillManifestParseError(
        `"${key}" must be a list of non-empty strings`,
        path
      );
    }
  }
  return v as ReadonlyArray<string>;
}
