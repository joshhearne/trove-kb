import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the slim runtime stage in the Dockerfile.
  output: "standalone",
  serverExternalPackages: ["pg"],
  /**
   * pg reaches for pg-cloudflare when it runs on Workers, where TCP goes
   * through cloudflare:sockets. Tracing copies the package manifest but not
   * its build output, so ask for the whole thing.
   *
   * The HEIC decoder is imported through a variable so the Worker bundler
   * leaves its 8 MB of WebAssembly alone; that also hides it from tracing, so
   * the container build has to be told to carry it.
   */
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pg-cloudflare/**",
      // heic-convert and everything it reaches for. Tracing cannot see through
      // the runtime specifier, so the whole chain is named here.
      "./node_modules/heic-convert/**",
      "./node_modules/heic-decode/**",
      // sharp rasterises an SVG icon to PNG; its native builds live under @img.
      "./node_modules/sharp/**",
      "./node_modules/@img/**",
      "./node_modules/libheif-js/**",
      "./node_modules/jpeg-js/**",
      "./node_modules/pngjs/**",
      // The emoji font PDF exports draw emoji with, read from disk at runtime.
      "./src/server/kb/fonts/**",
    ],
  },
  typedRoutes: true,
  // `next dev` otherwise appends its own agent block to CLAUDE.md whenever an
  // AI coding agent runs it, leaving a change nobody made in every checkout.
  agentRules: false,
};

export default nextConfig;
