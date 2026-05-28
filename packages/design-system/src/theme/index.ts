/**
 * @borjie/design-system/theme — colour-scheme runtime.
 *
 * Public API:
 *   - <ThemeProvider> — wrap the root layout of any Next.js app.
 *   - <ThemeToggle>   — drop into nav clusters; cycles light/dark/system.
 *   - useTheme()      — full hook with setters.
 *   - useColorScheme()— read-only effective scheme.
 *   - BORJIE_THEME_BOOTSTRAP_SCRIPT — inline into <head> to defeat FOUC.
 */
export {
  ThemeProvider,
  useTheme,
  useColorScheme,
  type Theme,
  type ResolvedTheme,
} from './ThemeProvider';
export { ThemeToggle, type ThemeToggleProps } from './ThemeToggle';
export { BORJIE_THEME_BOOTSTRAP_SCRIPT } from './bootstrap';
