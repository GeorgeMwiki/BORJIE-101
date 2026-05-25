/**
 * Accessibility — public surface.
 */
export { createAccessibilityScanner } from './scanner.js';
export type {
  AccessibilityScanner,
  AccessibilityScannerOptions,
} from './scanner.js';
export {
  WCAG_CHECK_REGISTRY,
  altTextCheck,
  infoAndRelationshipsCheck,
  identifyInputPurposeCheck,
  contrastCheck,
  reflowCheck,
  nonTextContrastCheck,
  keyboardCheck,
  focusOrderCheck,
  linkPurposeCheck,
  headingsAndLabelsCheck,
  focusVisibleCheck,
  draggingMovementsCheck,
  targetSizeCheck,
  consistentHelpCheck,
  redundantEntryCheck,
  nameRoleValueCheck,
} from './checks.js';
export type { WcagCheck } from './checks.js';
