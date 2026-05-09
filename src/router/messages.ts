/**
 * Phase 8 router error-message vocabulary. Per
 * `artifacts/decision-memo-phase-8.md` decision 5 + addendum B3 + B9.
 *
 * **Pinned strings**: every constant below is byte-exact and unit
 * asserted (Phase 4-style — em-dashes are U+2014, exact substitution
 * variable names, exact prefix). Changing any byte is a
 * `rulesetVersion` bump candidate (the strings are user-facing and
 * may appear in shared screenshots, error reports, or copy-paste
 * issue threads).
 *
 * **Substitution rule (advisory A5).** When a placeholder like
 * `<seed>`, `<repr>`, `<seed-repr>`, `<i>`, `<inner-error>`, `<N>` is
 * filled at throw time, the value is URL-decoded first; any byte
 * outside the printable-ASCII range U+0020..U+007E is replaced with
 * `\x<HH>` (uppercase hex). This is the byte-for-byte
 * representation surfaced in error messages — the original URL
 * is unaltered.
 */

/** `?run=` parameter present but not exactly 22 base64url chars. */
export const ROUTE_ERR_FP_INVALID =
  "url: ?run= must be 22 base64url characters (got <N>: <repr>)";

/** `?run=` parameter has a non-base64url byte. */
export const ROUTE_ERR_FP_BAD_CHAR =
  "url: ?run= contains non-base64url character at position <i>";

/** `?run=` present but `?seed=` missing. */
export const ROUTE_ERR_SEED_MISSING =
  "url: ?run= present but ?seed= missing — cannot reconstruct run";

/** `?seed=` value is empty or contains forbidden bytes. */
export const ROUTE_ERR_SEED_INVALID =
  "url: ?seed= invalid — must be a non-empty UTF-8 string with no NUL byte";

/** `?mods=` entry contains NUL or comma (forbidden). */
export const ROUTE_ERR_MODS_INVALID =
  "url: ?mods= entry <i> contains forbidden character (NUL or comma)";

/** `#log=` failed to base64url-decode or zlib-decompress. */
export const ROUTE_ERR_LOG_DECODE = "url: #log= failed to decode — <inner-error>";

/**
 * Fingerprint did not match any release in `releases/index.json`.
 * Bootstrap window: pre-8.A.3 minted URLs may surface this; the
 * message includes the seed substitution per addendum B9 so the
 * user can re-create the run on `latest/`.
 */
export const ROUTE_ERR_NO_MATCHING_RELEASE =
  "router: this run was created with a build that is not present in releases/index.json. The release may not yet be published (try refreshing in a minute) or may have been pruned. If this URL was shared before per-release pinning was live (Phase 8.A.3), the run can be re-created with seed '<seed>' on 'latest/'.";

/**
 * `?run=` matches the current build's fingerprint pre-image but only
 * because the URL was opened on the right `releases/<commit>/` —
 * the `?seed=` or `?mods=` was tampered with after fingerprint
 * generation. (Sub-case 5c.)
 */
export const ROUTE_ERR_FP_TAMPERED =
  "router: this run's fingerprint doesn't match its seed or mods — the URL may have been edited or corrupted; open the original sharer's URL or click 'New Run'";

/**
 * Phase-2 retry hit (memo addendum B3): the fingerprint matches some
 * release's `(commitHash, rulesetVersion, seed)` triple but with
 * `modIds: []` — the original `?mods=` was stripped or tampered
 * with. Disambiguates "wrong build" from "tampered URL".
 */
export const ROUTE_ERR_FP_NO_RELEASE_AT_THIS_SEED =
  "router: this run's fingerprint matches no release at the supplied seed '<seed-repr>'. Either the seed was edited after sharing, the URL was double-encoded by an email or link-shortener, or the build that produced the fingerprint was never published. Try opening the original sharer's URL or use 'New Run' with this seed.";

/**
 * `releases/index.json` could not be fetched or parsed; the router
 * cannot route mismatched-build URLs without it. Network error,
 * 404 (pre-8.A.3 deploy), or schema-shape mismatch all surface
 * here. Memo decision 5 prose at line 982.
 */
export const ROUTE_ERR_RELEASE_INDEX_FETCH =
  "router: failed to fetch releases/index.json — cannot route mismatched-build URLs (network error or release index missing)";

/**
 * Format a URL-decoded string for safe display in an error message.
 * Bytes outside the printable-ASCII range U+0020..U+007E are
 * substituted as `\x<HH>` (uppercase hex). Backslashes in the input
 * are escaped to `\\` so a printable backslash does not collide with
 * the synthetic escape syntax.
 *
 * Per memo addendum advisory A5.
 */
export function escapeForDisplay(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c) {
      out += "\\\\";
    } else if (c >= 0x20 && c <= 0x7e) {
      out += s.charAt(i);
    } else {
      out += "\\x" + c.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/**
 * Substitute placeholder tokens in a pinned error string. Each
 * placeholder in `replacements` is matched exactly (e.g. `<N>` not
 * `<n>`); unspecified placeholders are left intact for diagnostic
 * visibility (a developer reading `<inner-error>` in an unfilled
 * message can tell the substitution map was incomplete).
 */
export function fillTemplate(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let out = template;
  for (const key in replacements) {
    out = out.split(key).join(replacements[key]!);
  }
  return out;
}
