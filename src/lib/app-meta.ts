import pkg from "../../package.json";

/**
 * What the software is, as opposed to what an operator has branded it. The
 * name and logo in the interface are theirs to replace; this is the notice that
 * stays, because AGPL-3.0 §13 asks that people using it over a network can get
 * at the source.
 */
export const PRODUCT_NAME = "Trove KB";
/** Who makes it. This credit travels with the software, whoever runs it. */
export const VENDOR = "Hearne Technologies";
export const VENDOR_URL = "https://hearnetech.com";
/**
 * The vendor mark, copied into this repo rather than referenced from another.
 * One for each theme, since a mark drawn for a light background disappears on
 * a dark one.
 */
export const VENDOR_LOGO_LIGHT = "/vendor/hearne-technologies-light.png";
export const VENDOR_LOGO_DARK = "/vendor/hearne-technologies-dark.png";
export const LICENSE = "AGPL-3.0";
/**
 * package.json's version, for a build nobody stamped. A published build says
 * which release or dev build it is through TROVE_BUILD_VERSION, taken from
 * the release tag (src/server/updates/build-info.ts); the tag is the version.
 */
export const APP_VERSION: string = pkg.version;
export const SOURCE_URL = "https://github.com/joshhearne/trove-kb";
