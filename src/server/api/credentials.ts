/**
 * Finding the API key in a request. The key is what Trove KB handed out, and it
 * is accepted as it was handed out: with the `Bearer` scheme in front, which
 * is what the HTTP convention asks for, or on its own, which is what people
 * paste.
 *
 * Three headers carry it, read in this order:
 * - `X-Auth-Token`, the one a client should send. It names our key and nothing
 *   else, and it is on the list of headers an organization's custom MCP
 *   connector can set, where `Authorization` is not.
 * - `Authorization`, which existing desktop and command-line entries send.
 * - `X-API-Key`, read only when neither of the others is there.
 *
 * `X-Auth-Token` comes first because `Authorization` may hold a credential the
 * host added for itself. A header that is present but holds another scheme
 * (Basic, Digest) ends the search with no key, so a request is never judged by
 * a header its sender did not mean for us.
 *
 * Accepting the bare key gives nothing away. The key is the whole secret
 * either way; the word in front of it never was.
 */
export function presentedKey(headers: Headers): string {
  for (const name of ["x-auth-token", "authorization"]) {
    const value = headers.get(name)?.trim() ?? "";
    if (value !== "") return keyFrom(value);
  }

  return headers.get("x-api-key")?.trim() ?? "";
}

function keyFrom(value: string): string {
  const bearer = /^bearer\s+(\S.*)$/i.exec(value);
  if (bearer?.[1]) return bearer[1].trim();

  // Anything else with a space in it is another scheme — Basic, Digest —
  // and not a key of ours.
  return /\s/.test(value) ? "" : value;
}

/** What a caller with no key is told. One wording, wherever they knocked. */
export const NO_KEY_MESSAGE = "Provide an API key in the X-Auth-Token header";
