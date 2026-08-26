import type { NextConfig } from 'next';

/**
 * Security headers are set here rather than in middleware so they apply to
 * static assets and error pages too — middleware does not run for every
 * response, and a header that is only mostly present is not a control.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  {
    // Only meaningful over HTTPS; harmless in development.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Type and lint errors must fail the build. A build that succeeds while
  // `tsc` is unhappy trains everyone to ignore the type checker.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  experimental: {
    // Keeps heavy server-only dependencies out of any client graph.
    serverActions: { bodySizeLimit: '4mb' },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
