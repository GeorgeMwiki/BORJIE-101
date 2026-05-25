/**
 * `@borjie/portal-genui` — Brain-driven dynamic tab generator.
 *
 * The user talks to the MD agent ("we need to track our staff
 * payroll"); the intent detector flags a tab-generation intent; the
 * schema generator calls the multi-LLM synthesizer to draft a
 * `PortalTab` document; the renderer (in the admin-web)
 * mounts the tab inside the existing `PortalShell` immediately and
 * persists the document so it survives sign-out.
 *
 * Extends — does not replace — the `PortalLayout` document defined
 * in `packages/genui/src/document.ts`. That document covers the frame
 * (topbar, sidebar, dashboard cells); this package covers the dynamic
 * tabs that hang off the sidebar.
 *
 * Composition root wires it like:
 *
 *   const engine = createGenUIEngine({
 *     brain: makeBrainPortFromSynthesizer(synthesizer),
 *     persistence: createDrizzleTabRegistry({ db: getDb() }),
 *   });
 */

// Types
export * from './types.js';

// Intent
export * from './intent/index.js';

// Fields
export * from './fields/index.js';

// Widgets
export * from './widgets/index.js';

// Generator
export * from './generator/index.js';

// Persistence
export * from './persistence/index.js';

// Engine facade
export * from './engine.js';
