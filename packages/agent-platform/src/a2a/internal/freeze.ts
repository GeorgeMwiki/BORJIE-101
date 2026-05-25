/**
 * Deep-freeze helper — internal to the a2a sub-package.
 *
 * Returns the input cast as deeply readonly. Used by `buildAgentCard` and
 * `deserializeAgentCard` so callers cannot mutate a card after construction.
 */
export function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object') freezeDeep(child);
  }
  return value;
}
