/**
 * Data grounding — the "secret sauce" of the tutor.
 *
 * For a concept whose `dataBinding` is set, we pull live tenant data
 * through the injected adapter, then substitute the resolved values
 * into the worked-example prompt + answer + explanation using
 * `{{placeholder}}` syntax.
 *
 * Every substituted number carries a `DataCitation` back to the row
 * id, so the UI can render "your TRC NOI for Sept 2025 was X (ledger
 * entry abc-123)" with a drill-in affordance.
 *
 * RULE: never construct SQL from LLM output. Adapters dispatch to
 * typed repositories. If the adapter can't satisfy a binding, the
 * orchestrator falls back to the static example text with a clear
 * "[data unavailable]" marker — the lesson still runs.
 */

import type {
  TutoringConcept,
  TutoringWorkedExample,
  TutoringDataAdapter,
  DataCitation,
  TutoringDataBinding,
} from './types.js';

/** Substitute `{{key}}` tokens in a string with resolved values. */
export function substitute(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key];
    if (v == null) return `[${key}]`;
    return formatValue(v);
  });
}

/**
 * Render a resolved value for inclusion in lesson text. Numbers get
 * locale-friendly thousands separators; objects fall back to JSON.
 */
function formatValue(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v.toLocaleString('en-US');
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface GroundedWorkedExample {
  readonly prompt: string;
  readonly answer: string;
  readonly explanation: string;
  readonly citations: readonly DataCitation[];
}

/**
 * Resolve a worked example against live data. If the concept has no
 * data binding, the example renders with its placeholders intact
 * (the seed text uses generic `{{period_label}}` etc. that read fine
 * untouched).
 */
export async function groundWorkedExample(input: {
  readonly concept: TutoringConcept;
  readonly tenantId: string;
  readonly dataAdapter: TutoringDataAdapter;
}): Promise<GroundedWorkedExample> {
  const ex: TutoringWorkedExample = input.concept.content.worked_example;

  if (input.concept.dataBinding == null) {
    return {
      prompt: ex.prompt,
      answer: ex.answer,
      explanation: ex.explanation,
      citations: [],
    };
  }

  let values: Readonly<Record<string, unknown>> = {};
  let citations: readonly DataCitation[] = [];
  try {
    const resolved = await input.dataAdapter.resolve({
      tenantId: input.tenantId,
      binding: input.concept.dataBinding,
    });
    values = resolved.values;
    citations = resolved.citations;
  } catch {
    // Soft degrade: keep the static example text. The lesson still
    // teaches the concept; we just don't have live numbers today.
    values = {};
    citations = [];
  }

  return {
    prompt: substitute(ex.prompt, values),
    answer: substitute(ex.answer, values),
    explanation: substitute(ex.explanation, values),
    citations,
  };
}

/** Reference in-memory adapter used in tests / dev. */
export class StubTutoringDataAdapter implements TutoringDataAdapter {
  private readonly fixtures: Map<
    string,
    {
      readonly values: Readonly<Record<string, unknown>>;
      readonly citations: readonly DataCitation[];
    }
  >;

  constructor(
    fixtures: Record<
      string,
      {
        readonly values: Readonly<Record<string, unknown>>;
        readonly citations: readonly DataCitation[];
      }
    > = {},
  ) {
    this.fixtures = new Map(Object.entries(fixtures));
  }

  register(
    source: string,
    fixture: {
      readonly values: Readonly<Record<string, unknown>>;
      readonly citations: readonly DataCitation[];
    },
  ): void {
    this.fixtures.set(source, fixture);
  }

  async resolve(input: {
    readonly tenantId: string;
    readonly binding: TutoringDataBinding;
  }): Promise<{
    readonly values: Readonly<Record<string, unknown>>;
    readonly citations: readonly DataCitation[];
  }> {
    const fixture = this.fixtures.get(input.binding.source);
    if (!fixture) {
      return { values: {}, citations: [] };
    }
    return fixture;
  }
}
