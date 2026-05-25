/**
 * Generic render-block tool factory.
 *
 * Every render-block tool follows the SAME shape:
 *   1. The agent calls it with a payload typed against the primitive's
 *      Zod schema.
 *   2. The tool validates the payload with `safeParse`.
 *      - On failure → `ToolOutcome.error` (agent loop runs repair-pass).
 *   3. For chart-vega, an EXTRA ajv pass validates the spec.
 *   4. On success → returns `{ kind, ...validatedData }` shaped as an
 *      `AgUiUiPart`, packaged in a `ToolOutcome.ok`.
 *
 * Citations: render-block tools do not (themselves) add citations; the
 * upstream tool that produced the data (e.g. portfolio.concentration)
 * is the source of truth. The render-block tool just shapes that data
 * for the client. Tools forward any caller-provided citations through
 * `args.input._citations` (private extension field, stripped from the
 * emitted UiPart).
 */

import type { z } from 'zod';

import type { ScopeContext, Tool, ToolInput, ToolOutcome, Citation } from '../../../types.js';
import type { AgUiUiPart } from './ag-ui-types.js';
import { validateVegaSpec } from './validate.js';

/** Internal extension: caller can pass through citations that
 *  describe where the rendered data came from. Stripped from the
 *  emitted UiPart so the client never sees these. */
interface InternalRenderInput {
  readonly _citations?: ReadonlyArray<Citation>;
}

interface RenderBlockToolDef<Part extends AgUiUiPart> {
  readonly name: `render-blocks.${Part['kind']}`;
  readonly kind: Part['kind'];
  readonly description: string;
  readonly schema: z.ZodTypeAny;
  /** JSON Schema that Claude/OpenAI uses to construct valid inputs. */
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
}

const PLATFORM_AND_TENANT_SCOPES: ReadonlyArray<ScopeContext['kind']> = ['platform', 'tenant'];

function errorOutcome(message: string): ToolOutcome<never> {
  return { kind: 'error', message, retryable: false };
}

/**
 * Build a render-block tool from a primitive definition.
 *
 * The returned tool is callable from BOTH `tenant` and `platform`
 * scopes — render-blocks are pure data-shaping operations with no
 * I/O side-effects, so cross-scope use is safe.
 */
export function createRenderBlockTool<Part extends AgUiUiPart>(
  def: RenderBlockToolDef<Part>,
): Tool<unknown, Part> {
  return {
    name: def.name,
    description: def.description,
    inputJsonSchema: def.inputJsonSchema,
    scopes: PLATFORM_AND_TENANT_SCOPES,
    async invoke(args: ToolInput<unknown>): Promise<ToolOutcome<Part>> {
      const startedAt = Date.now();

      // Strip internal extension fields the model isn't supposed to know about.
      const rawInput = args.input as InternalRenderInput & Record<string, unknown>;
      const { _citations: passthroughCitations, ...payload } = rawInput;

      // Inject the discriminant if the LLM omitted it. The Zod schema
      // requires `kind` so this also doubles as a guard.
      const candidate = { ...payload, kind: def.kind };

      const parsed = def.schema.safeParse(candidate);
      if (!parsed.success) {
        const flat = parsed.error.issues
          .slice(0, 8)
          .map((i) => `${i.path.join('.') || '$'}: ${i.message}`)
          .join('; ');
        return errorOutcome(
          `render-blocks.${def.kind}: validation failed — ${flat}`,
        );
      }

      // Extra ajv pass for chart-vega specs.
      if (def.kind === 'chart-vega') {
        const part = parsed.data as { spec: Readonly<Record<string, unknown>> };
        const vega = validateVegaSpec(part.spec);
        if (!vega.ok) {
          return errorOutcome(
            `render-blocks.chart-vega: invalid Vega-Lite spec — ${vega.errors
              .slice(0, 4)
              .join('; ')}`,
          );
        }
      }

      // Sanitize prefill-form action: must be relative URL or same-host.
      if (def.kind === 'prefill-form') {
        const p = parsed.data as { action: string };
        if (
          !p.action.startsWith('/') &&
          !p.action.startsWith('api/') &&
          !/^https?:\/\//.test(p.action)
        ) {
          return errorOutcome(
            'render-blocks.prefill-form: action must be relative path or http(s) URL',
          );
        }
      }

      const out: Part = parsed.data as unknown as Part;
      return {
        kind: 'ok',
        ok: true,
        output: out,
        latencyMs: Date.now() - startedAt,
        citations: passthroughCitations ?? [],
        artifact: null,
      };
    },
  };
}
