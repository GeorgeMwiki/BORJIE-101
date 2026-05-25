/**
 * `currentUnified` — fetch the canonical view for a subject from a
 * caller-provided store. The store is a tiny port so the package
 * stays DB-free.
 */
import type { ProfileFragment, UnifiedProfile, UnifyRules } from '../types.js';
import { unifyProfile } from './unify.js';

export interface FragmentStore {
  /** Return all fragments for the subject in this tenant. */
  fragmentsForSubject(args: {
    readonly tenantId: string;
    readonly subjectId: string;
  }): Promise<ReadonlyArray<ProfileFragment>>;
}

export interface CurrentUnifiedArgs {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly store: FragmentStore;
  readonly rules: UnifyRules;
}

export async function currentUnified(
  args: CurrentUnifiedArgs,
): Promise<UnifiedProfile | null> {
  const fragments = await args.store.fragmentsForSubject({
    tenantId: args.tenantId,
    subjectId: args.subjectId,
  });
  if (fragments.length === 0) return null;
  return unifyProfile({
    subjectId: args.subjectId,
    fragments,
    rules: args.rules,
  });
}
