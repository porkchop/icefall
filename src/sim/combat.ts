/**
 * Phase 3 combat — frozen-contract items 2 (roll-derivation function),
 * 3 (roll-domain registry), 4 (combat damage formula), and 13 (damage
 * clamp + short-circuit) from the Phase 3 decision memo addendum.
 *
 * The roll pre-image, fully spelled (addendum B1 + B2):
 *
 *   rollBytes(stateHashPre, action, domain, index)
 *     = sha256(
 *         stateHashPre              // 32 bytes
 *       ‖ encodeAction(action)      // Phase 1 wire format
 *       ‖ utf8("icefall:roll:v1:")  // 16 bytes, fixed anchor
 *       ‖ [utf8(domain).length:1]   // 1 byte
 *       ‖ utf8(domain)              // 1..31 bytes
 *       ‖ DataView.setUint32(_, index, true)  // 4 bytes, LE u32
 *     )
 *
 *   rollU32(...) = ((b[0] | (b[1]<<8) | (b[2]<<16) | (b[3]<<24)) >>> 0)
 *                  where b = rollBytes(...)[0..4]
 *
 * Bit extraction from the u32 uses **low-bit AND mask** only (e.g.
 * `& 0x03` for 0..3); top-bit shifts are not used. Future helpers
 * (`rollU64`, etc.) consume non-overlapping byte ranges of the same
 * subhash and are pinned at point of introduction.
 */

import { sha256, utf8, concat, isWellFormedUtf16 } from "../core/hash";
import { encodeAction, type Action } from "../core/encode";
import { ROLL_DOMAIN_ANCHOR_BYTES } from "./params";

const MAX_DOMAIN_BYTES = 31;
const U32_MAX = 0xffffffff;

/**
 * Build the per-roll subhash. Frozen — see addendum B1 for the byte
 * layout.
 */
export function rollBytes(
  stateHashPre: Uint8Array,
  action: Action,
  domain: string,
  index: number,
): Uint8Array {
  if (!isWellFormedUtf16(domain)) {
    throw new Error("rollBytes: domain contains unpaired surrogate");
  }
  const domainBytes = utf8(domain);
  if (domainBytes.length < 1 || domainBytes.length > MAX_DOMAIN_BYTES) {
    throw new Error(
      `rollBytes: domain UTF-8 byte length must be 1..${MAX_DOMAIN_BYTES} (got ${domainBytes.length})`,
    );
  }
  if (!Number.isInteger(index) || index < 0 || index > U32_MAX) {
    throw new Error(`rollBytes: index out of u32 range (got ${index})`);
  }

  const lpDomain = new Uint8Array(1 + domainBytes.length);
  lpDomain[0] = domainBytes.length;
  lpDomain.set(domainBytes, 1);

  const idxLE = new Uint8Array(4);
  new DataView(idxLE.buffer).setUint32(0, index, true);

  return sha256(
    concat([
      stateHashPre,
      encodeAction(action),
      ROLL_DOMAIN_ANCHOR_BYTES,
      lpDomain,
      idxLE,
    ]),
  );
}

/**
 * Bytes 0..4 of the per-call subhash, little-endian unsigned 32-bit.
 * Frozen — see addendum B2.
 */
export function rollU32(
  stateHashPre: Uint8Array,
  action: Action,
  domain: string,
  index: number,
): number {
  const b = rollBytes(stateHashPre, action, domain, index);
  return (
    ((b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0)
  );
}

/** Phase 3 frozen domain set — see addendum B3 + N6. */
export const ROLL_DOMAIN_ATK_BONUS = "combat:atk-bonus" as const;
export const ROLL_DOMAIN_COUNTER_BONUS = "combat:counter-bonus" as const;

/**
 * Compute the bonus for a damage roll. Low 2 bits of the u32 — uniform
 * over [0..3]. Frozen-contract item 4.
 */
export function damageBonus(
  stateHashPre: Uint8Array,
  action: Action,
  domain: string,
  index: number,
): number {
  return rollU32(stateHashPre, action, domain, index) & 0x03;
}

/**
 * Compute the integer damage from attacker to defender given the bonus.
 * Floor at 1 (frozen-contract item 4). Integer-only — `Math.max` is not
 * float-producing here since both inputs are integers.
 */
export function damageAmount(
  attackerAtk: number,
  defenderDef: number,
  bonus: number,
): number {
  return Math.max(1, attackerAtk - defenderDef + bonus);
}

/**
 * Apply integer damage to an HP value with the Phase 3 N7 clamp.
 * Returns the clamped new HP. Caller short-circuits subsequent rolls
 * when the result is 0.
 */
export function clampHp(hp: number, dmg: number): number {
  return Math.max(0, hp - dmg);
}
