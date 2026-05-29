/**
 * parseContextSet — strip `<context_set ... />` tags from the brain's
 * reply, validate the stack payload, and return the cleaned body +
 * extracted breadcrumb stack.
 *
 * Wave KNOWLEDGE-HANDOFF — K-D.
 *
 * The brain emits this tag when it WANTS to narrow the entity-index
 * relevance to a specific crumb stack. The FE applies the new stack
 * to the global breadcrumb provider so subsequent turns inherit it.
 *
 * Tag shape (XML-style with embedded JSON payload — keeps parser
 * symmetric with the existing `<board_add>` primitive):
 *
 *   <context_set>{
 *     "stack": [
 *       { "kind": "site", "id": "mwadui", "label": "Mwadui",
 *         "scopeId": "mwadui" },
 *       { "kind": "worker", "id": "w_hassan", "label": "Worker Hassan" }
 *     ]
 *   }</context_set>
 *
 * Defensive policy:
 *  - Caps at one context_set per turn (the brain should emit at most
 *    one; we keep the FIRST and drop the rest).
 *  - Drops any payload that fails the zod validation.
 *  - Strips the tag from the body either way.
 *  - The stack itself is capped at 8 crumbs (matches the FE cap).
 */

import { z } from 'zod';

const TAG_PATTERN = /<context_set>\s*(\{[\s\S]*?\})\s*<\/context_set>/gi;
const MAX_STACK = 8;

const crumbSchema = z
  .object({
    kind: z.string().min(1).max(40),
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    scopeId: z.string().min(1).max(80).optional(),
  })
  .strict();

const stackSchema = z
  .object({
    stack: z.array(crumbSchema).min(1).max(MAX_STACK),
  })
  .strict();

export interface ContextCrumbPayload {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly scopeId?: string;
}

export interface ParseContextSetResult {
  readonly body: string;
  readonly stack: ReadonlyArray<ContextCrumbPayload> | null;
  readonly dropped: number;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseContextSet(text: string): ParseContextSetResult {
  let stack: ReadonlyArray<ContextCrumbPayload> | null = null;
  let dropped = 0;
  let captured = false;

  const body = text.replace(TAG_PATTERN, (_match, json: string) => {
    if (captured) {
      dropped += 1;
      return '';
    }
    const parsed = safeParseJson(json);
    if (!parsed || typeof parsed !== 'object') {
      dropped += 1;
      return '';
    }
    const validated = stackSchema.safeParse(parsed);
    if (!validated.success) {
      dropped += 1;
      return '';
    }
    captured = true;
    stack = Object.freeze(
      validated.data.stack.map((c) =>
        Object.freeze({
          kind: c.kind,
          id: c.id,
          label: c.label,
          ...(c.scopeId !== undefined && { scopeId: c.scopeId }),
        }),
      ),
    );
    return '';
  });

  return Object.freeze({ body, stack, dropped });
}
