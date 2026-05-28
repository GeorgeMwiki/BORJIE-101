import type { MetadataRoute } from 'next';

/**
 * Borjie Console PWA manifest. The internal admin console is rarely
 * installed as a PWA, but shipping the manifest keeps icon resolution
 * + theme-color in line with the owner and marketing surfaces.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Borjie Console',
    short_name: 'Borjie',
    description:
      'Borjie Console — internal admin surfaces for tenants, corpus, prompt and model registry, compliance, killswitch.',
    start_url: '/',
    display: 'standalone',
    background_color: '#17100A',
    theme_color: '#17100A',
    orientation: 'landscape',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'developer-tools', 'productivity'],
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
