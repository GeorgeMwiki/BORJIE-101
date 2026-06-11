/**
 * SOTA security headers (S-4 pre-launch audit 2026-05-29).
 *
 * Admin-web carries the highest-blast-radius surface (Borjie staff
 * console). The recipe is identical to `apps/owner-web/next.config.js`
 * so a single review covers both — see that file for header rationale
 * and cross-references.
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
  // IP-shield (client-inspection hardening 2026-06-09): never emit browser
  // source-maps in production builds. Source-maps would re-expose original
  // module names, comments, and any inlined constant — handing an inspector a
  // de-minified view of the client. Defense-in-depth: it is the Next default,
  // but the audit flagged the missing explicit setting; pinning it here makes
  // the posture provable and `borjie-client-secret-scan.yml` asserts no `.map`
  // ever ships in `.next/static`.
  productionBrowserSourceMaps: false,
  transpilePackages: [
    '@borjie/app-shell',
    '@borjie/design-system',
    '@borjie/graph-privacy',
    '@borjie/observability',
    '@borjie/performance-toolkit',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@tanstack/react-query',
      '@borjie/design-system',
      '@borjie/chat-ui',
    ],
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
  async headers() {
    return [
      { source: '/(.*)', headers: SECURITY_HEADERS },
    ];
  },
};

module.exports = nextConfig;
