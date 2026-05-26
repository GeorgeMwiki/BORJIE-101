import type { MetadataRoute } from 'next';

/**
 * Borjie PWA manifest. Mining sheds in Geita and Songwe often run on
 * intermittent connectivity; a manifest lets owners pin the cockpit-
 * lite landing page to their home screen and have a real chrome-free
 * experience the next time they open it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Borjie',
    short_name: 'Borjie',
    description:
      'AI-native operating system for Tanzanian mining. Master Brain, licence calendar, FX & treasury, marketplace, compliance pack.',
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
