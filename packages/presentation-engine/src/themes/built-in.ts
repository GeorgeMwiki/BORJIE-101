/**
 * Platform built-in presentation themes — TS-mirror of the five rows
 * seeded by migration 0209_presentation_themes.sql.
 *
 * Themes describe the slide-master: dimensions, color palette, fonts,
 * logo position, and the list of allowed layout slugs. The
 * presentation orchestrator hands a theme into the .pptx renderer and
 * the rendered file picks up the visual identity.
 */

import type { PresentationSlideMasterSpec } from '@borjie/report-engine';

export interface PresentationTheme {
  readonly id: string;
  readonly tenantId: string | null;
  readonly slug: string;
  readonly displayName: string;
  readonly slideMaster: PresentationSlideMasterSpec;
  readonly isBuiltIn: boolean;
}

function theme(
  id: string,
  slug: string,
  displayName: string,
  slideMaster: PresentationSlideMasterSpec,
): PresentationTheme {
  return {
    id,
    tenantId: null,
    slug,
    displayName,
    slideMaster,
    isBuiltIn: true,
  };
}

const DEFAULT_LAYOUTS: readonly string[] = [
  'title',
  'bullet',
  'chart',
  'image',
  'section-divider',
];

export const BUILT_IN_THEMES: Readonly<Record<string, PresentationTheme>> = {
  classic_corporate: theme(
    'theme_classic_corporate',
    'classic_corporate',
    'Classic Corporate',
    {
      dimensions: { w: 13.333, h: 7.5 },
      colors: {
        primary: '#1F3864',
        secondary: '#4472C4',
        accent: '#FFC000',
        text: '#333333',
        background: '#FFFFFF',
        muted: '#7F7F7F',
      },
      fonts: {
        title: 'Calibri',
        body: 'Calibri',
        accent: 'Calibri Light',
      },
      logoPosition: { x: 0.4, y: 0.3, w: 1.2, h: 0.6, anchor: 'top-left' },
      layouts: DEFAULT_LAYOUTS,
    },
  ),

  modern_clean: theme(
    'theme_modern_clean',
    'modern_clean',
    'Modern Clean',
    {
      dimensions: { w: 13.333, h: 7.5 },
      colors: {
        primary: '#0E7C7B',
        secondary: '#17BEBB',
        accent: '#FFC857',
        text: '#2D3047',
        background: '#FFFFFF',
        muted: '#A6A6A6',
      },
      fonts: { title: 'Helvetica', body: 'Helvetica', accent: 'Helvetica' },
      logoPosition: {
        x: 11.733,
        y: 0.3,
        w: 1.2,
        h: 0.6,
        anchor: 'top-right',
      },
      layouts: DEFAULT_LAYOUTS,
    },
  ),

  minimal_dark: theme(
    'theme_minimal_dark',
    'minimal_dark',
    'Minimal Dark',
    {
      dimensions: { w: 13.333, h: 7.5 },
      colors: {
        primary: '#FFFFFF',
        secondary: '#BBBBBB',
        accent: '#F95738',
        text: '#FFFFFF',
        background: '#0B0C10',
        muted: '#666666',
      },
      fonts: { title: 'Inter', body: 'Inter', accent: 'Inter' },
      logoPosition: { x: 0.4, y: 0.3, w: 1.2, h: 0.6, anchor: 'top-left' },
      layouts: DEFAULT_LAYOUTS,
    },
  ),

  government_serious: theme(
    'theme_government_serious',
    'government_serious',
    'Government Serious',
    {
      dimensions: { w: 13.333, h: 7.5 },
      colors: {
        primary: '#003366',
        secondary: '#336699',
        accent: '#B22222',
        text: '#000000',
        background: '#F5F5F5',
        muted: '#666666',
      },
      fonts: {
        title: 'Times New Roman',
        body: 'Times New Roman',
        accent: 'Times New Roman',
      },
      logoPosition: { x: 0.4, y: 0.3, w: 0.8, h: 0.8, anchor: 'top-left' },
      layouts: DEFAULT_LAYOUTS,
    },
  ),

  africa_warm: theme(
    'theme_africa_warm',
    'africa_warm',
    'Africa Warm',
    {
      dimensions: { w: 13.333, h: 7.5 },
      colors: {
        primary: '#C75B12',
        secondary: '#F2A65A',
        accent: '#3A5311',
        text: '#3D3027',
        background: '#FFF8E7',
        muted: '#8C6E54',
      },
      fonts: { title: 'Lato', body: 'Lato', accent: 'Lato' },
      logoPosition: { x: 0.4, y: 0.3, w: 1.2, h: 0.6, anchor: 'top-left' },
      layouts: DEFAULT_LAYOUTS,
    },
  ),
};
