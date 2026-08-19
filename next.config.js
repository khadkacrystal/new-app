/* @flashmandu-template next.config.js@0.4.0 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    'curled-salary-remarry.ngrok-free.dev',
    'crystal.business-dev.autohisab.com',
    'business-dev.autohisab.com',
  ],

  transpilePackages: ['@flashmandu/app-bridge-ui'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:* http://localhost",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
