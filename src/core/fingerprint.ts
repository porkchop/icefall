import { sha256, base64url, utf8, concat, isWellFormedUtf16 } from "./hash";
import { PLACEHOLDER_RULESET_VERSION } from "../build-info";

export const FINGERPRINT_SHORT_LEN = 22;
export const DEV_PREFIX = "DEV-";

export type FingerprintInputs = {
  commitHash: string;
  rulesetVersion: string;
  seed: string;
  modIds: readonly string[];
};

const SEPARATOR = new Uint8Array([0x00]);

function ensureNoSeparators(label: string, value: string): void {
  if (!isWellFormedUtf16(value)) {
    throw new Error(`fingerprint: ${label} contains unpaired surrogate`);
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x00) {
      throw new Error(`fingerprint: ${label} must not contain NUL`);
    }
  }
}

function ensureNoSeparatorsModId(value: string, idx: number): void {
  if (!isWellFormedUtf16(value)) {
    throw new Error(`fingerprint: modId[${idx}] contains unpaired surrogate`);
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x00 || c === 0x2c) {
      throw new Error(
        `fingerprint: modId[${idx}] must not contain NUL or comma`,
      );
    }
  }
}

export function fingerprintBytes(inputs: FingerprintInputs): Uint8Array {
  ensureNoSeparators("commitHash", inputs.commitHash);
  ensureNoSeparators("rulesetVersion", inputs.rulesetVersion);
  ensureNoSeparators("seed", inputs.seed);
  for (let i = 0; i < inputs.modIds.length; i++) {
    ensureNoSeparatorsModId(inputs.modIds[i]!, i);
  }
  const sortedMods = [...inputs.modIds].sort();
  return sha256(
    concat([
      utf8(inputs.commitHash),
      SEPARATOR,
      utf8(inputs.rulesetVersion),
      SEPARATOR,
      utf8(inputs.seed),
      SEPARATOR,
      utf8(sortedMods.join(",")),
    ]),
  );
}

/**
 * Compute the 22-character short fingerprint. When `rulesetVersion` is
 * the Phase 1 placeholder sentinel, emits a `DEV-` prefix so the result
 * is recognizably non-shareable; Phase 4 will refuse to load any
 * fingerprint with that prefix.
 */
export function fingerprint(inputs: FingerprintInputs): string {
  const short = base64url(fingerprintBytes(inputs)).slice(
    0,
    FINGERPRINT_SHORT_LEN,
  );
  if (inputs.rulesetVersion === PLACEHOLDER_RULESET_VERSION) {
    return DEV_PREFIX + short;
  }
  return short;
}

/**
 * Compute the full 43-character fingerprint. Used by the verifier path;
 * never prefixed.
 */
export function fingerprintFull(inputs: FingerprintInputs): string {
  return base64url(fingerprintBytes(inputs));
}
