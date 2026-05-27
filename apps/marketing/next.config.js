/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@borjie/design-system', '@borjie/performance-toolkit'],
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
};

module.exports = nextConfig;
