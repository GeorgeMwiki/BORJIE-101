/**
 * Deterministic, dependency-free describer stub.
 *
 * The "describe" stage is a port — production wires Claude. This stub
 * synthesises a name + description from the intent and the tool sequence
 * with no LLM call, so:
 *   - tests get deterministic output, and
 *   - a zero-LLM deployment still captures (degraded but functional) skills.
 *
 * Pure + deterministic. Same input → same output.
 *
 * @module @borjie/skill-library/skill-capture/heuristic-describer
 */

import type { SkillDescriber } from './types.js';

/**
 * Build a heuristic describer. The produced name is derived from the
 * intent's leading keywords; the description lists the ordered tool
 * sequence so retrieval embeddings still capture the procedure shape.
 */
export function createHeuristicDescriber(): SkillDescriber {
  return async ({ intent, steps, jurisdiction }) => {
    const keywords = topKeywords(intent, 4);
    const namePart = keywords.length > 0 ? keywords.join(' ') : 'captured task';
    const name = titleCase(namePart);
    const tools = steps.map((s) => s.tool).join(' → ');
    const scope = jurisdiction === 'platform' ? 'platform-wide' : `${jurisdiction} tenants`;
    const description =
      `Reusable procedure for "${intent.trim()}" (${scope}). ` +
      `Steps: ${tools}.`;
    return { name, description };
  };
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
  'her', 'was', 'one', 'our', 'out', 'his', 'has', 'had', 'let', 'put',
  'say', 'she', 'too', 'use', 'with', 'this', 'that', 'have', 'from',
  'your', 'there', 'their', 'about', 'would', 'could', 'should', 'them',
  'were', 'please', 'need',
]);

function topKeywords(text: string, limit: number): ReadonlyArray<string> {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= limit) break;
  }
  return out;
}

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
