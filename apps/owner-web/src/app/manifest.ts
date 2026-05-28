import type { MetadataRoute } from 'next';

/**
 * Borjie Owner Cockpit PWA manifest. Owners running on intermittent
 * shed connectivity pin the cockpit to their home screen — the
 * manifest gives them a chrome-free standalone experience.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Borjie — Owner Cockpit',
    short_name: 'Borjie',
    description:
      'Strategic cockpit for Tanzanian mining owners. Master Brain, LMBM, treasury, compliance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#17100A',
    theme_color: '#17100A',
    orientation: 'portrait',
    lang: 'sw',
    dir: 'ltr',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
