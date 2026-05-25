import type { Preview } from '@storybook/react-vite';

/**
 * Storybook 10 preview config — three-state story matrix per
 * section (empty / loading / populated). Backgrounds + viewports
 * follow the BORJIE design-system convention from the
 * `@borjie/design-system` package.
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
    viewport: {
      viewports: {
        mobile: {
          name: 'Mobile (375px)',
          styles: { width: '375px', height: '740px' },
          type: 'mobile',
        },
        tablet: {
          name: 'Tablet (768px)',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
        desktop: {
          name: 'Desktop (1280px)',
          styles: { width: '1280px', height: '800px' },
          type: 'desktop',
        },
      },
    },
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default preview;
