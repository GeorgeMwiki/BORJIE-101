/**
 * Central environment-variable helpers.
 *
 * Use `requireEnv` for any config that MUST be present at runtime
 * (URLs, API keys, secrets, tokens, model/provider IDs, endpoints, hosts).
 *
 * Silent fallbacks (`process.env.X || 'something'`) are an anti-pattern
 * because they hide missing production config behind a working-but-wrong
 * default. Prefer `requireEnv` and fail fast.
 *
 * Use `optionalEnv` when the value is genuinely optional and you treat
 * `undefined` explicitly downstream.
 *
 * Use `envFlag` for boolean toggles.
 */

/**
 * Returns the value of the named env var, or throws if missing/empty.
 *
 * @throws Error when the env var is unset or whitespace-only.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Returns the value of the named env var, or `undefined` if missing/empty.
 * Callers MUST handle the `undefined` case explicitly.
 */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    return undefined;
  }
  return value;
}

/**
 * Returns true when the env var is set to a truthy flag value
 * (`1`, `true`, `yes`, case-insensitive). Returns `defaultValue` when unset.
 */
export function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
