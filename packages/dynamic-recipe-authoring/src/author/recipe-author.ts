/**
 * Recipe author orchestrator — Wave 18M.
 *
 * Pure dependency-injected function. Five steps:
 *
 *   1. Validate the request envelope (kind + utterance non-empty).
 *   2. Assemble the kind-specific prompt.
 *   3. Call the injected LLM port.
 *   4. Validate the LLM's JSON against the kind-specific contract.
 *   5. Persist the validated spec via the repository and return a
 *      RecipeAuthorResult carrying the row plus the legal next
 *      lifecycle transitions.
 *
 * The orchestrator NEVER throws on bad input; it surfaces the
 * accumulated errors as `{ok: false, ...}` so the caller UI can
 * render every problem at once. The only errors that bubble are
 * persistence-layer faults (the repository's `insert` throws — we
 * catch and wrap into a `persistence_error` result).
 *
 * @module @borjie/dynamic-recipe-authoring/author/recipe-author
 */

import type {
  AuthoredRecipeRepository,
  LlmAuthorPort,
  RecipeAuthorRequest,
  RecipeAuthorResult,
  RecipeKind,
} from '../types.js';
import {
  DEFAULT_VERSION,
  LLM_AUTHOR_IDENTITY,
} from '../types.js';
import { validateRecipe } from '../validator/recipe-validator.js';
import { buildTabRecipePrompt } from '../prompts/tab-recipe-prompt.js';
import { buildDocRecipePrompt } from '../prompts/doc-recipe-prompt.js';
import { nextTransitions } from '../lifecycle/lifecycle-bridge.js';

export interface RecipeAuthorDeps {
  readonly llm: LlmAuthorPort;
  readonly repository: AuthoredRecipeRepository;
  readonly now?: () => Date;
  /**
   * Per-kind prompt builders. Defaults to the v1 builders for `tab`
   * and `doc`. The shape-only kinds (`media`, `campaign`, `tool`) do
   * not have a v1 prompt and the orchestrator rejects them as
   * `unsupported_kind` unless the caller injects a custom builder.
   */
  readonly promptBuilders?: PromptBuilders;
}

export type PromptBuilder = (args: {
  readonly intentUtterance: string;
  readonly desiredName?: string;
}) => string;

export type PromptBuilders = Readonly<Partial<Record<RecipeKind, PromptBuilder>>>;

const DEFAULT_PROMPT_BUILDERS: PromptBuilders = Object.freeze({
  tab: (args) =>
    args.desiredName !== undefined
      ? buildTabRecipePrompt({
          intentUtterance: args.intentUtterance,
          desiredName: args.desiredName,
        })
      : buildTabRecipePrompt({ intentUtterance: args.intentUtterance }),
  doc: (args) =>
    args.desiredName !== undefined
      ? buildDocRecipePrompt({
          intentUtterance: args.intentUtterance,
          desiredName: args.desiredName,
        })
      : buildDocRecipePrompt({ intentUtterance: args.intentUtterance }),
});

/**
 * Build a recipe-author orchestrator. The returned function is the
 * package's primary entry point.
 */
export function createRecipeAuthor(deps: RecipeAuthorDeps) {
  const promptBuilders: PromptBuilders = {
    ...DEFAULT_PROMPT_BUILDERS,
    ...(deps.promptBuilders ?? {}),
  };

  return {
    async author(request: RecipeAuthorRequest): Promise<RecipeAuthorResult> {
      // ── 1. Validate the request envelope.
      const envelopeErrors = validateRequestEnvelope(request);
      if (envelopeErrors.length > 0) {
        return {
          ok: false,
          code: 'invalid_request',
          errors: envelopeErrors,
        };
      }

      // ── 2. Pick prompt builder.
      const builder = promptBuilders[request.kind];
      if (builder === undefined) {
        return {
          ok: false,
          code: 'unsupported_kind',
          errors: [
            `kind: no prompt builder registered for "${request.kind}". Inject one via promptBuilders.`,
          ],
        };
      }

      // ── 3. Assemble prompt + call the LLM.
      const prompt =
        request.desiredName !== undefined
          ? builder({
              intentUtterance: request.intentUtterance,
              desiredName: request.desiredName,
            })
          : builder({ intentUtterance: request.intentUtterance });

      let llmOutput;
      try {
        llmOutput = await deps.llm({
          kind: request.kind,
          intentUtterance: request.intentUtterance,
          prompt,
        });
      } catch (error) {
        return {
          ok: false,
          code: 'invalid_spec',
          errors: [`llm port failed: ${stringifyError(error)}`],
        };
      }

      // ── 4. Validate the LLM's JSON against the kind contract.
      const validation = validateRecipe(request.kind, llmOutput.spec);
      if (!validation.ok) {
        return {
          ok: false,
          code: 'invalid_spec',
          errors: validation.errors,
        };
      }

      // ── 5. Persist + return.
      const name = deriveName({
        request,
        validatedSpec: validation.spec,
      });
      const version = request.desiredVersion ?? DEFAULT_VERSION;
      const authoredBy = request.authoredBy.length > 0
        ? request.authoredBy
        : LLM_AUTHOR_IDENTITY;

      try {
        const persisted = await deps.repository.insert({
          tenantId: request.tenantId,
          kind: request.kind,
          name,
          version,
          spec: validation.spec,
          authoredBy,
        });
        return {
          ok: true,
          recipe: persisted,
          nextTransitions: nextTransitions(persisted.lifecycleState),
        };
      } catch (error) {
        return {
          ok: false,
          code: 'persistence_error',
          errors: [`repository.insert failed: ${stringifyError(error)}`],
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateRequestEnvelope(
  request: RecipeAuthorRequest,
): ReadonlyArray<string> {
  const errors: string[] = [];
  if (request.tenantId.trim().length === 0) {
    errors.push('tenantId: must be non-empty');
  }
  if (request.intentUtterance.trim().length === 0) {
    errors.push('intentUtterance: must be non-empty');
  }
  if (request.authoredBy.trim().length === 0) {
    errors.push('authoredBy: must be non-empty');
  }
  if (request.desiredVersion !== undefined) {
    if (!/^\d+\.\d+\.\d+$/.test(request.desiredVersion)) {
      errors.push(
        `desiredVersion: must be a semver triple (got "${request.desiredVersion}")`,
      );
    }
  }
  return errors;
}

function deriveName(args: {
  readonly request: RecipeAuthorRequest;
  readonly validatedSpec: Readonly<Record<string, unknown>>;
}): string {
  if (args.request.desiredName !== undefined && args.request.desiredName.length > 0) {
    return args.request.desiredName;
  }
  const specId = args.validatedSpec['id'];
  if (typeof specId === 'string' && specId.length > 0) {
    return specId;
  }
  // Fallback — slugify the utterance.
  return slugify(args.request.intentUtterance);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
