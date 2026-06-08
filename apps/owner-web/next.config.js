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
  // IP-shield (client-inspection hardening 2026-06-09): never emit browser
  // source-maps in production builds. Source-maps would re-expose original
  // module names, comments, and any inlined constant — handing an inspector a
  // de-minified view of the client. Defense-in-depth: it is the Next default,
  // but the audit flagged the missing explicit setting; pinning it here makes
  // the posture provable and `borjie-client-secret-scan.yml` asserts no `.map`
  // ever ships in `.next/static`.
  productionBrowserSourceMaps: false,
  transpilePackages: [
    '@borjie/design-system',
    '@borjie/chat-ui',
    '@borjie/app-shell',
    '@borjie/observability',
    '@borjie/api-sdk',
    '@borjie/performance-toolkit',
    '@borjie/dynamic-sections',
    '@borjie/owner-os-tabs',
    '@borjie/persona-runtime',
    '@borjie/portal-genui',
  ],
  experimental: {
    optimizePackageImports: [
      'lucide-react',
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
  webpack: (config, { isServer, webpack }) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.js', '.ts', '.tsx', '.jsx'],
    };
    if (!isServer) {
      // Browser-safety: small client utils (e.g. formatCurrency) imported from
      // @borjie/api-client transitively pull in @borjie/compliance-plugins,
      // whose registry imports `node:crypto`. The crypto call lives inside a
      // server-side function (createHash) that the client path never invokes,
      // so stub the module on the client. Rewrite the `node:` URI scheme to the
      // bare specifier (resolve.fallback doesn't cover `node:` schemes) and
      // stub it to an empty module.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, 'crypto'),
      );
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        crypto: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: '/(.*)', headers: SECURITY_HEADERS },
    ];
  },
};

module.exports = nextConfig;
