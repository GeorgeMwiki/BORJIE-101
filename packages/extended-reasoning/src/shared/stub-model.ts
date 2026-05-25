import type { ModelAdapter, ModelInput } from './types.js';

/**
 * Deterministic model stub for tests. Looks up a response by matching the
 * prompt against a list of (pattern → response) entries. First match wins.
 *
 * Patterns can be:
 *   - a plain string (substring match)
 *   - a RegExp (regex match)
 *   - a predicate function over `ModelInput`
 *
 * Falls back to the optional `defaultResponse`, otherwise throws — failing
 * loudly in tests is preferable to a silent empty string that would mask
 * a missing fixture.
 */
export interface StubRule {
  readonly match: string | RegExp | ((input: ModelInput) => boolean);
  readonly respond: string | ((input: ModelInput) => string);
}

export interface StubModelOptions {
  readonly rules: ReadonlyArray<StubRule>;
  readonly defaultResponse?: string;
  /** Track how many times each rule fired — useful for asserting call counts. */
  readonly trackCalls?: boolean;
}

export interface StubModel {
  readonly call: ModelAdapter;
  readonly callCount: () => number;
  readonly callsMatchingRule: (ruleIndex: number) => number;
}

export function createStubModel(options: StubModelOptions): StubModel {
  const ruleCounts = new Array<number>(options.rules.length).fill(0);
  let total = 0;

  const call: ModelAdapter = async (input) => {
    total += 1;
    for (let i = 0; i < options.rules.length; i += 1) {
      const rule = options.rules[i];
      if (rule === undefined) continue;
      if (matches(rule.match, input)) {
        if (options.trackCalls !== false) {
          ruleCounts[i] = (ruleCounts[i] ?? 0) + 1;
        }
        return typeof rule.respond === 'function' ? rule.respond(input) : rule.respond;
      }
    }
    if (options.defaultResponse !== undefined) return options.defaultResponse;
    throw new Error(
      `[StubModel] no rule matched prompt (truncated): ${input.prompt.slice(0, 120)}`,
    );
  };

  return {
    call,
    callCount: () => total,
    callsMatchingRule: (i) => ruleCounts[i] ?? 0,
  };
}

function matches(
  match: StubRule['match'],
  input: ModelInput,
): boolean {
  if (typeof match === 'string') return input.prompt.includes(match);
  if (match instanceof RegExp) return match.test(input.prompt);
  return match(input);
}
