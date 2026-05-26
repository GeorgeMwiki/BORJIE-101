/**
 * Disclaimer-presence checker — per spec §8.
 *
 * Verifies that every required disclaimer string from the recipe's
 * ComplianceContract is present in the body. Whitespace-tolerant,
 * case-insensitive substring match. Returns the missing list.
 */

export interface DisclaimerCheckArgs {
  readonly body: string;
  readonly required_disclaimers: ReadonlyArray<string>;
}

export function findMissingDisclaimers(
  args: DisclaimerCheckArgs,
): ReadonlyArray<string> {
  const normalized = normalize(args.body);
  const missing: Array<string> = [];
  for (const disclaimer of args.required_disclaimers) {
    if (!normalized.includes(normalize(disclaimer))) {
      missing.push(disclaimer);
    }
  }
  return Object.freeze(missing);
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}
