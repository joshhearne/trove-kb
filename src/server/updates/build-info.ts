import { APP_VERSION } from "@/lib/app-meta";

/**
 * Which build is running. A published image, or a bare-metal release the host
 * updater built, is stamped with these at build time; anything else is the
 * package.json version, with nothing known about its commit.
 *
 *   TROVE_BUILD_VERSION  v1.2.0 for a release, dev-<sha7> for a dev build
 *   TROVE_BUILD_COMMIT   the full commit
 *   TROVE_BUILT_AT       ISO time of the build
 */
export type BuildInfo = {
  version: string;
  commit: string | null;
  builtAt: Date | null;
  /** A build from the dev branch rather than a release. */
  development: boolean;
};

export function getBuildInfo(
  env: Record<string, string | undefined> = process.env,
): BuildInfo {
  const version = env.TROVE_BUILD_VERSION?.trim() || `v${APP_VERSION}`;
  const commit = env.TROVE_BUILD_COMMIT?.trim() || null;
  const builtAt = env.TROVE_BUILT_AT ? new Date(env.TROVE_BUILT_AT) : null;
  return {
    version,
    commit,
    builtAt: builtAt && !Number.isNaN(builtAt.getTime()) ? builtAt : null,
    development: version.startsWith("dev-"),
  };
}
