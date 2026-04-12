/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  pageExtensions: ['ts', 'tsx'],
  typescript: {
    // Ignore type errors during production build — fix types in dev
    ignoreBuildErrors: true,
  },
  eslint: {
    // Ignore ESLint errors during production build
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
