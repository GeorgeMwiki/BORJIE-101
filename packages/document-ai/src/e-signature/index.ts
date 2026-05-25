/**
 * @borjie/document-ai/e-signature — public barrel.
 *
 * Four adapters cover the full vendor landscape for Borjie:
 *   - DocuSign    (US + EU; AES/QES capable)
 *   - HelloSign   (US + EU SES/AES; great Dropbox-native UX)
 *   - Adobe Sign  (US + EU full eIDAS via SignCare)
 *   - Mock        (deterministic; pdf-lib fallback for INTERNAL_ONLY)
 */

export { createMockESignAdapter } from './mock-adapter.js';
export type { MockESignAdapterConfig } from './mock-adapter.js';

export { createDocuSignAdapter } from './docusign-adapter.js';
export type { DocuSignAdapterConfig } from './docusign-adapter.js';

export { createHelloSignAdapter } from './hellosign-adapter.js';
export type { HelloSignAdapterConfig } from './hellosign-adapter.js';

export { createAdobeSignAdapter } from './adobe-sign-adapter.js';
export type { AdobeSignAdapterConfig } from './adobe-sign-adapter.js';
