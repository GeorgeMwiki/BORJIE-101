/**
 * GenUI rendering pattern — declarative component descriptors.
 *
 * LITFIN ref: src/core/ui/genui/* — the LLM emits a JSON description
 * of the UI, which is validated and compiled into a tree that the host
 * (React/Vue/Solid) renders. We export the schema, validator, and the
 * compile-step that maps unknown LLM JSON to a typed tree.
 */

import { z } from 'zod';

export const GenUIPrimitive = z.enum([
  'container',
  'heading',
  'paragraph',
  'list',
  'listItem',
  'button',
  'link',
  'image',
  'card',
  'tableLite',
  'badge',
  'divider',
]);
export type GenUIPrimitive = z.infer<typeof GenUIPrimitive>;

export const GenUIProps = z
  .object({
    text: z.string().optional(),
    href: z.string().optional(),
    src: z.string().optional(),
    intent: z.enum(['primary', 'secondary', 'destructive', 'ghost']).optional(),
    level: z.number().int().min(1).max(6).optional(),
    onClickEventId: z.string().optional(),
    ariaLabel: z.string().optional(),
  })
  .strict();
export type GenUIProps = z.infer<typeof GenUIProps>;

export interface GenUINode {
  readonly id: string;
  readonly type: GenUIPrimitive;
  readonly props: GenUIProps;
  readonly children: readonly GenUINode[];
}

const RawGenUINode: z.ZodType<GenUINode> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      type: GenUIPrimitive,
      props: GenUIProps,
      children: z.array(RawGenUINode),
    })
    .strict(),
);

export interface CompileResult {
  readonly tree: GenUINode | null;
  readonly errors: readonly string[];
}

const MAX_NODE_COUNT = 500;
const MAX_DEPTH = 20;

const validateLimits = (
  node: GenUINode,
  depth: number,
  count: { value: number },
  errors: string[],
): void => {
  count.value++;
  if (count.value > MAX_NODE_COUNT) {
    errors.push(`node-count-exceeded:${MAX_NODE_COUNT}`);
    return;
  }
  if (depth > MAX_DEPTH) {
    errors.push(`depth-exceeded:${MAX_DEPTH}`);
    return;
  }
  for (const c of node.children) validateLimits(c, depth + 1, count, errors);
};

/** Compile unknown LLM output into a validated tree. Defensive — every
 *  failure mode produces a partial result with reasons. */
export const compile = (raw: unknown): CompileResult => {
  const parsed = RawGenUINode.safeParse(raw);
  if (!parsed.success) {
    return { tree: null, errors: parsed.error.issues.map((i) => i.message) };
  }
  const errors: string[] = [];
  validateLimits(parsed.data, 0, { value: 0 }, errors);
  if (errors.length > 0) return { tree: null, errors };
  return { tree: parsed.data, errors: [] };
};

/** Walk the tree depth-first. Useful for collecting event handlers. */
export const walk = (
  node: GenUINode,
  visit: (n: GenUINode, depth: number) => void,
  depth: number = 0,
): void => {
  visit(node, depth);
  for (const c of node.children) walk(c, visit, depth + 1);
};

/** Collect all `onClickEventId` values so the host can wire handlers. */
export const collectEvents = (node: GenUINode): readonly string[] => {
  const out: string[] = [];
  walk(node, (n) => {
    if (n.props.onClickEventId !== undefined) out.push(n.props.onClickEventId);
  });
  return out;
};
