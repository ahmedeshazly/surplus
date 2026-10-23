// Owner: R5.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // .env is optional in CI and on fresh clones
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@surplus/contracts"],
  // Linting runs from the repo root (pnpm lint), not inside next build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
