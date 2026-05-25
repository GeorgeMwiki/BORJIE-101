/**
 * Tool-decomposition patterns — split complex tools into atomic
 * primitives so the LLM picks them with fewer hallucinations.
 *
 * LITFIN ref: src/core/agent-orchestration/* — a compound tool is
 * decomposed into a step list at registration time and replayed at
 * runtime, with each step calling an atomic primitive.
 */

import { z } from 'zod';

export const AtomicToolDef = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  /** JSONSchema describing inputs. Kept opaque to avoid coupling. */
  inputSchema: z.unknown(),
});
export type AtomicToolDef = z.infer<typeof AtomicToolDef>;

export const CompoundToolStep = z.object({
  /** The atomic tool to invoke. */
  toolName: z.string().min(1),
  /** Mustache-style placeholders pull values from prior step outputs. */
  inputTemplate: z.record(z.string(), z.string()),
  /** Output binding key — later steps reference via `{$bind}`. */
  outputKey: z.string().optional(),
});
export type CompoundToolStep = z.infer<typeof CompoundToolStep>;

export const CompoundToolDef = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(CompoundToolStep).min(1),
});
export type CompoundToolDef = z.infer<typeof CompoundToolDef>;

// ------------------------------------------------------------------
// Resolver — substitutes `{$bind}` placeholders from a context map.
// ------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\$([a-zA-Z0-9_.-]+)\}/g;

export const resolvePlaceholders = (
  template: string,
  ctx: ReadonlyMap<string, string>,
): string =>
  template.replace(PLACEHOLDER_RE, (_, key: string) => ctx.get(key) ?? `{$${key}}`);

export const resolveInputs = (
  template: Readonly<Record<string, string>>,
  ctx: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = resolvePlaceholders(v, ctx);
  }
  return out;
};

export interface RegistryEntry<T = unknown> {
  readonly def: AtomicToolDef;
  readonly run: (input: Readonly<Record<string, string>>) => Promise<T>;
}

export interface CompoundExecutionContext {
  readonly bindings: ReadonlyMap<string, string>;
  readonly stepResults: readonly { readonly step: number; readonly toolName: string; readonly bound: string | null }[];
}

const stringify = (v: unknown): string =>
  typeof v === 'string' ? v : JSON.stringify(v ?? null);

/**
 * Run a compound tool end-to-end with a registry of atomic primitives.
 * Stops on the first error and returns the partial context for debug.
 */
export const runCompoundTool = async (
  def: CompoundToolDef,
  registry: ReadonlyMap<string, RegistryEntry>,
  initialBindings: ReadonlyMap<string, string> = new Map(),
): Promise<
  | { readonly ok: true; readonly context: CompoundExecutionContext }
  | { readonly ok: false; readonly reason: string; readonly context: CompoundExecutionContext }
> => {
  const bindings = new Map(initialBindings);
  const stepResults: { step: number; toolName: string; bound: string | null }[] = [];
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i];
    if (step === undefined) continue;
    const entry = registry.get(step.toolName);
    if (entry === undefined) {
      return {
        ok: false,
        reason: `unknown-tool:${step.toolName}`,
        context: { bindings, stepResults },
      };
    }
    const input = resolveInputs(step.inputTemplate, bindings);
    try {
      const result = await entry.run(input);
      const bound = step.outputKey !== undefined ? stringify(result) : null;
      if (step.outputKey !== undefined && bound !== null) {
        bindings.set(step.outputKey, bound);
      }
      stepResults.push({ step: i, toolName: step.toolName, bound });
    } catch (e) {
      return {
        ok: false,
        reason: `step-${i}-failed:${(e as Error).message}`,
        context: { bindings, stepResults },
      };
    }
  }
  return { ok: true, context: { bindings, stepResults } };
};
