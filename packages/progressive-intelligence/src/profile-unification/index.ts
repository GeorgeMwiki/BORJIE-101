/**
 * Public surface for profile unification.
 */
export {
  linkFragments,
  type LinkFragmentsArgs,
} from './link.js';
export {
  unifyProfile,
  incorporateFragment,
  type UnifyProfileArgs,
} from './unify.js';
export {
  currentUnified,
  type CurrentUnifiedArgs,
  type FragmentStore,
} from './current-unified.js';
