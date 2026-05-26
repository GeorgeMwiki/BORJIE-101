/**
 * Module-side-effect declarations for the marketing app.
 *
 * Next.js 15 + Tailwind v4 lets you do `import './globals.css'` for
 * the side effect of registering global styles. TypeScript needs to
 * be told that CSS imports are valid even though they emit no JS
 * symbols — this declaration silences `TS2882` without making the
 * import return any actual binding.
 */
declare module '*.css';
