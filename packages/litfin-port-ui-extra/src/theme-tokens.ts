/**
 * Theme tokens — light / dark / high-contrast.
 *
 * LITFIN ref: src/core/design-system/* — OKLCH-based palette aligned
 * with shadcn's CSS variable shape so consumers can drop these into
 * `:root { --primary: ... }` blocks.
 */

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export interface ThemeTokens {
  readonly mode: ThemeMode;
  readonly tokens: Readonly<Record<string, string>>;
}

export const LIGHT: ThemeTokens = {
  mode: 'light',
  tokens: {
    '--background': 'oklch(99% 0.002 264)',
    '--foreground': 'oklch(15% 0.02 264)',
    '--card': 'oklch(99% 0.002 264)',
    '--card-foreground': 'oklch(15% 0.02 264)',
    '--popover': 'oklch(99% 0.002 264)',
    '--popover-foreground': 'oklch(15% 0.02 264)',
    '--primary': 'oklch(55% 0.18 250)',
    '--primary-foreground': 'oklch(99% 0.002 264)',
    '--secondary': 'oklch(95% 0.01 264)',
    '--secondary-foreground': 'oklch(15% 0.02 264)',
    '--muted': 'oklch(95% 0.01 264)',
    '--muted-foreground': 'oklch(45% 0.02 264)',
    '--accent': 'oklch(95% 0.01 264)',
    '--accent-foreground': 'oklch(15% 0.02 264)',
    '--destructive': 'oklch(58% 0.22 25)',
    '--destructive-foreground': 'oklch(99% 0.002 264)',
    '--border': 'oklch(92% 0.005 264)',
    '--input': 'oklch(92% 0.005 264)',
    '--ring': 'oklch(55% 0.18 250)',
    '--radius': '0.5rem',
  },
};

export const DARK: ThemeTokens = {
  mode: 'dark',
  tokens: {
    '--background': 'oklch(12% 0.02 264)',
    '--foreground': 'oklch(96% 0.005 264)',
    '--card': 'oklch(15% 0.02 264)',
    '--card-foreground': 'oklch(96% 0.005 264)',
    '--popover': 'oklch(15% 0.02 264)',
    '--popover-foreground': 'oklch(96% 0.005 264)',
    '--primary': 'oklch(68% 0.16 250)',
    '--primary-foreground': 'oklch(12% 0.02 264)',
    '--secondary': 'oklch(22% 0.015 264)',
    '--secondary-foreground': 'oklch(96% 0.005 264)',
    '--muted': 'oklch(22% 0.015 264)',
    '--muted-foreground': 'oklch(65% 0.01 264)',
    '--accent': 'oklch(22% 0.015 264)',
    '--accent-foreground': 'oklch(96% 0.005 264)',
    '--destructive': 'oklch(64% 0.21 25)',
    '--destructive-foreground': 'oklch(12% 0.02 264)',
    '--border': 'oklch(22% 0.015 264)',
    '--input': 'oklch(22% 0.015 264)',
    '--ring': 'oklch(68% 0.16 250)',
    '--radius': '0.5rem',
  },
};

export const HIGH_CONTRAST: ThemeTokens = {
  mode: 'high-contrast',
  tokens: {
    '--background': 'oklch(100% 0 0)',
    '--foreground': 'oklch(0% 0 0)',
    '--card': 'oklch(100% 0 0)',
    '--card-foreground': 'oklch(0% 0 0)',
    '--popover': 'oklch(100% 0 0)',
    '--popover-foreground': 'oklch(0% 0 0)',
    '--primary': 'oklch(35% 0.25 250)',
    '--primary-foreground': 'oklch(100% 0 0)',
    '--secondary': 'oklch(85% 0 0)',
    '--secondary-foreground': 'oklch(0% 0 0)',
    '--muted': 'oklch(90% 0 0)',
    '--muted-foreground': 'oklch(0% 0 0)',
    '--accent': 'oklch(85% 0 0)',
    '--accent-foreground': 'oklch(0% 0 0)',
    '--destructive': 'oklch(40% 0.3 25)',
    '--destructive-foreground': 'oklch(100% 0 0)',
    '--border': 'oklch(0% 0 0)',
    '--input': 'oklch(0% 0 0)',
    '--ring': 'oklch(35% 0.25 250)',
    '--radius': '0.25rem',
  },
};

export const ALL_THEMES: Readonly<Record<ThemeMode, ThemeTokens>> = {
  light: LIGHT,
  dark: DARK,
  'high-contrast': HIGH_CONTRAST,
};

/** Render a CSS string for the given theme. Suitable for inlining. */
export const renderCss = (theme: ThemeTokens, selector: string = ':root'): string => {
  const lines: string[] = [`${selector} {`];
  for (const [k, v] of Object.entries(theme.tokens)) {
    lines.push(`  ${k}: ${v};`);
  }
  lines.push('}');
  return lines.join('\n');
};
