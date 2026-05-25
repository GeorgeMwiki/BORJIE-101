/**
 * @borjie/document-ai/accessibility — public barrel.
 */

export { enforceArchivalQuality, embedFontsIfMissing } from './pdf-a-validator.js';
export type { PDFAValidatorConfig } from './pdf-a-validator.js';

export { enforceAccessibility, addAccessibilityTags } from './pdf-ua-validator.js';
export type { PDFUAValidatorConfig } from './pdf-ua-validator.js';
