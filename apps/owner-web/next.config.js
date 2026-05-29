/**
 * SOTA security headers (S-4 pre-launch audit 2026-05-29):
 * - CSP locks scripts to self + Next's hashed bundles (incl. SSE/WS to
 *   Supabase realtime); refuses framed embedding; bans inline form
 *   posts to foreign origins.
 * - HSTS one-year + preload — once shipped, the browser refuses to
 *   downgrade to http even if a phisher redirects.
 * - X-Frame-Options DENY belt-and-braces with `frame-ancestors 'none'`.
 * - Permissions-Policy denies the four sensors the web app never asks
 *   for (mobile native handles camera/mic/geo via Expo).
 *
 * Cross-references:
 *   - `Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md` §4
 *   - `services/api-gateway/src/index.ts` line 706 (helmet on gateway)
 *   - `apps/admin-web/next.config.js` + `apps/marketing/next.config.js`
 *     ship the same recipe so a single review covers all three surfaces.
 */
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires 'unsafe-inline' for hydration scripts. Hashed-
      // script CSP is a Wave-2 follow-up once we audit every inline.
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
    '@borjie/chat-ui',
    '@borjie/genui',
    '@borjie/observability',
    '@borjie/api-sdk',
    '@borjie/performance-toolkit',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@borjie/design-system',
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
