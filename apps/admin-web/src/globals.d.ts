// Ambient declarations for CSS side-effect imports.
// TypeScript 6.x's noUncheckedSideEffectImports flag (default true under
// strict) requires explicit `*.css` module declarations even when Next.js
// supports them at the bundler layer.
declare module '*.css';
