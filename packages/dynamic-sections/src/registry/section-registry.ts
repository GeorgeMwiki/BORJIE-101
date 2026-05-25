/**
 * `SectionRegistry` — the in-memory store sections register against.
 *
 * Immutable-by-construction (every mutation returns a new registry
 * instance). Cheap to pass around, safe to memoise. Constructed once
 * in the portal's root provider and seeded with whatever the tenant
 * needs.
 */

import type { Section } from '../contracts/section.js';

export class SectionRegistry {
  private readonly _sections: readonly Section[];

  constructor(sections: readonly Section[] = []) {
    this._sections = sections;
  }

  /**
   * Return all registered sections (unfiltered). Use the
   * `useSectionRegistry()` hook for filtered-by-context output.
   */
  get all(): readonly Section[] {
    return this._sections;
  }

  /**
   * Return a section by key, or undefined if not present.
   */
  get(key: string): Section | undefined {
    return this._sections.find((s) => s.key === key);
  }

  /**
   * Return a new registry with the supplied section added. Throws on
   * duplicate keys — section identity must be stable for URL slugs
   * and React keys to work.
   */
  register(section: Section): SectionRegistry {
    if (this._sections.some((s) => s.key === section.key)) {
      throw new Error(
        `SectionRegistry.register: duplicate section key '${section.key}'`,
      );
    }
    return new SectionRegistry([...this._sections, section]);
  }

  /**
   * Return a new registry with the named section removed. Idempotent
   * — removing a missing key is a no-op.
   */
  unregister(key: string): SectionRegistry {
    return new SectionRegistry(this._sections.filter((s) => s.key !== key));
  }

  /**
   * Bulk-register helper. Maintains the immutability invariant by
   * delegating to `register` repeatedly.
   */
  registerAll(sections: readonly Section[]): SectionRegistry {
    return sections.reduce<SectionRegistry>(
      (acc, s) => acc.register(s),
      this,
    );
  }
}
