import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx,mdx}',
    '../../packages/design-system/src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'oklch(0.18 0.02 80)',
        foreground: 'oklch(0.95 0.01 80)',
        primary: 'oklch(0.58 0.12 65)',
        accent: 'oklch(0.78 0.16 75)',
        border: 'oklch(0.30 0.02 80)',
        surface: 'oklch(0.22 0.02 80)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
