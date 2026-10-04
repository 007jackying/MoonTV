/** @type {import('next').NextConfig} */
/* eslint-disable @typescript-eslint/no-var-requires */

const nextConfig = {
  output: 'standalone',
  eslint: {
    dirs: ['src'],
    ignoreDuringBuilds: true,
  },

  reactStrictMode: false,
  swcMinify: true,

  // Build output directory. The e2e harness overrides this (see
  // tests/e2e/serve.mjs) so a harness run cannot collide with a `next dev` you
  // already have going: two dev servers sharing one .next overwrite each other's
  // on-demand-compile manifests, which surfaces as ENOENT / 500s on random
  // routes rather than anything to do with the code under test.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

// Setup Cloudflare Pages development platform in development mode
if (process.env.NODE_ENV === 'development') {
  const { setupDevPlatform } = require('@cloudflare/next-on-pages/next-dev');
  setupDevPlatform();
}

// Disable PWA on Cloudflare Pages (edge runtime conflicts) and in dev
const isCloudflarePages =
  process.env.CF_PAGES === '1' ||
  process.env.CLOUDFLARE_PAGES === '1' ||
  process.argv.includes('pages:build');

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development' || isCloudflarePages,
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);
