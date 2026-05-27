/**
 * Tokenises a post body into a stream of plain-text segments and
 * `EntityRef` tokens. The recogniser intentionally only matches three
 * shapes the LLM is contractually instructed to emit:
 *
 *   @user-id       → { kind: 'user',   id, label: '@user-id'   }
 *   #region-id     → { kind: 'region', id, label: '#region-id' }
 *   $tool-id       → { kind: 'tool',   id, label: '$tool-id'   }
 *
 * The id is letters/digits/dashes/dots only, so it survives common
 * punctuation (period at end of sentence) without dragging it into
 * the link. No mutation — every token is a new object.
 */

import type { EntityRef } from '../types';

export type EntityToken =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'ref'; readonly ref: EntityRef };

const TOKEN_RE = /([@#$])([A-Za-z0-9][A-Za-z0-9.\-_]*)/g;

function refForSigil(sigil: string, id: string): EntityRef | null {
  switch (sigil) {
    case '@':
      return { kind: 'user', id, label: `@${id}` };
    case '#':
      return { kind: 'region', id, label: `#${id}` };
    case '$':
      return { kind: 'tool', id, label: `$${id}` };
    default:
      return null;
  }
}

/**
 * Parse a post body into an alternating sequence of text segments and
 * entity refs. Pure — same input always produces the same output.
 */
export function parseEntities(body: string): ReadonlyArray<EntityToken> {
  if (!body) return [{ kind: 'text', value: '' }];
  const tokens: EntityToken[] = [];
  let lastIndex = 0;
  // Reset the regex state — TOKEN_RE has the `g` flag so it carries
  // `lastIndex` across calls. Cloning the regex each invocation is
  // simpler and tiny in cost.
  const re = new RegExp(TOKEN_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const [whole, sigilRaw, idRaw] = match;
    if (!sigilRaw || !idRaw) continue;
    const ref = refForSigil(sigilRaw, idRaw);
    if (!ref) continue;
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: body.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: 'ref', ref });
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < body.length) {
    tokens.push({ kind: 'text', value: body.slice(lastIndex) });
  }
  if (tokens.length === 0) {
    tokens.push({ kind: 'text', value: body });
  }
  return tokens;
}
