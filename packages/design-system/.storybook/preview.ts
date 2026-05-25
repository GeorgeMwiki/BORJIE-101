import type { Preview } from '@storybook/react-vite';
import '../src/styles/globals.css';

/**
 * Storybook 10 preview configuration (Phase D11, 2026-05-17).
 *
 * Migration notes:
 *   - `parameters.actions.argTypesRegex` was deprecated in Storybook 8
 *     and removed in v10. Stories that need to spy on event handlers
 *     should opt-in per-story with `args: { onClick: fn() }` from
 *     `storybook/test`. Dropping the regex here is the v10-blessed
 *     pattern.
 *   - Controls matchers and backgrounds remain on the v10 stable API.
 *   - The `@storybook/react` Preview type moved to
 *     `@storybook/react-vite` — the framework-specific entrypoint is
 *     the canonical import in v10.
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#ffffff' },
        { name: 'dark', value: '#0b1220' },
      ],
    },
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default preview;
