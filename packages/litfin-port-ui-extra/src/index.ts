/**
 * `@borjie/litfin-port-ui-extra` — public surface.
 *
 * LITFIN-ported UI patterns:
 *   - shadcn variant tokens (button-loading, table-with-virtual,
 *     drawer-with-resize)
 *   - autosave + dirty-tracking + warn-on-leave form helpers
 *   - motion presets (table-row, modal, drawer, fade)
 *   - theme tokens system (light / dark / high-contrast, OKLCH)
 *   - accessibility helpers (skip-to-main, focus-trap, ARIA-live)
 *   - GenUI declarative render-tree compiler
 */

export * from './shadcn-variants.js';
export * from './form-autosave.js';
export * from './motion-presets.js';
export * from './theme-tokens.js';
export * from './accessibility-helpers.js';
export * from './genui-render-tree.js';
