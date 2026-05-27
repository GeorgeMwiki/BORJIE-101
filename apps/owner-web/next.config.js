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
};

module.exports = nextConfig;
