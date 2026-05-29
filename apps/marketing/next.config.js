/**
 * SOTA security headers (S-4 pre-launch audit 2026-05-29).
 *
 * Marketing carries the unauthenticated public-chat surface — same
 * recipe as owner-web/admin-web so a single review covers all three.
 * See `apps/owner-web/next.config.js` for header rationale and
 * cross-references.
 *
 * The marketing CSP allows `script-src 'self' 'unsafe-inline'` for
 * Next hydration. If we ever embed Calendly/HubSpot/etc, ship an SRI
 * hash + add the foreign origin to script-src in the same PR.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://*.borjie.com wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: [
    '@borjie/design-system',
    '@borjie/performance-toolkit',
    '@borjie/chat-ui',
    '@borjie/genui',
    '@borjie/api-sdk',
  ],
  // SOTA lazy-load Wave: image optimisation defaults.
  // - AVIF first (≈ 50 % smaller than JPEG, 95 % browser support 2026)
  //   then WebP fallback. Cite: web.dev/image-cwv 2026.
  // - Pin the device + image grid so the CDN can pre-warm a finite set
  //   instead of inflating arbitrary responsive sizes per visitor.
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [375, 640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31_536_000,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', '@borjie/design-system'],
  },
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{ kebabCase member }}',
      preventFullImport: true,
    },
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.js', '.ts', '.tsx', '.jsx'],
    };
    return config;
  },
  async redirects() {
    return [];
  },
  async headers() {
    return [
      { source: '/(.*)', headers: SECURITY_HEADERS },
    ];
  },
};

module.exports = nextConfig;
