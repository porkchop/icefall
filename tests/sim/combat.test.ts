import { describe, expect, it } from "vitest";
import { sha256, utf8, concat } from "../../src/core/hash";
import { encodeAction } from "../../src/core/encode";
import {
  rollBytes,
  rollU32,
  damageBonus,
  damageAmount,
  clampHp,
  ROLL_DOMAIN_ATK_BONUS,
  ROLL_DOMAIN_COUNTER_BONUS,
} from "../../src/sim/combat";
import { ROLL_DOMAIN_ANCHOR_TEXT } from "../../src/sim/params";

const FAKE_STATE = sha256(utf8("phase-3-combat-test-state"));
const FAKE_ACTION = { type: "attack", dir: 1 as const };

describe("rollBytes — frozen pre-image format (addendum B1)", () => {
  it("returns a 32-byte SHA-256 digest", () => {
    const out = rollBytes(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0);
    expect(out.length).toBe(32);
  });

  it("matches the byte-explicit pre-image: state || encodeAction || anchor || lp(domain) || u32_le(index)", () => {
    const domain = "combat:atk-bonus";
    const idx = 7;
    const domainBytes = utf8(domain);
    const lpDomain = new Uint8Array(1 + domainBytes.length);
    lpDomain[0] = domainBytes.length;
    lpDomain.set(domainBytes, 1);
    const idxLE = new Uint8Array(4);
    new DataView(idxLE.buffer).setUint32(0, idx, true);
    const expected = sha256(
      concat([
        FAKE_STATE,
        encodeAction(FAKE_ACTION),
        utf8(ROLL_DOMAIN_ANCHOR_TEXT),
        lpDomain,
        idxLE,
      ]),
    );
    const got = rollBytes(FAKE_STATE, FAKE_ACTION, domain, idx);
    expect(Array.from(got)).toEqual(Array.from(expected));
  });

  it("differs across distinct domains", () => {
    const a = rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 0);
    const b = rollBytes(FAKE_STATE, FAKE_ACTION, "combat:counter-bonus", 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("differs across distinct indices", () => {
    const a = rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 0);
    const b = rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 1);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("differs across distinct actions even at same state", () => {
    const a = rollBytes(FAKE_STATE, { type: "attack", dir: 1 as const }, "combat:atk-bonus", 0);
    const b = rollBytes(FAKE_STATE, { type: "attack", dir: 2 as const }, "combat:atk-bonus", 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("rejects empty domain", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "", 0),
    ).toThrowError(/UTF-8 byte length must be 1\.\.31/);
  });

  it("rejects domain over 31 bytes", () => {
    const tooLong = "a".repeat(32);
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, tooLong, 0),
    ).toThrowError(/UTF-8 byte length must be 1\.\.31/);
  });

  it("rejects domain with unpaired surrogate", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "\uD800", 0),
    ).toThrowError(/unpaired surrogate/);
  });

  it("rejects negative index", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", -1),
    ).toThrowError(/u32 range/);
  });

  it("rejects non-integer index", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 1.5),
    ).toThrowError(/u32 range/);
  });

  it("rejects index > 2^32 - 1", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 0x100000000),
    ).toThrowError(/u32 range/);
  });

  it("accepts boundary index 0 and 2^32 - 1", () => {
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 0),
    ).not.toThrow();
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "combat:atk-bonus", 0xffffffff),
    ).not.toThrow();
  });

  it("accepts UTF-8 multi-byte domain (within 31 bytes)", () => {
    // "💩" is 4 bytes; domain has 4 + 1 = 5 bytes
    expect(() =>
      rollBytes(FAKE_STATE, FAKE_ACTION, "x💩", 0),
    ).not.toThrow();
  });
});

describe("rollU32 — frozen byte order (addendum B2)", () => {
  it("returns an unsigned 32-bit integer (little-endian from bytes 0..4)", () => {
    const u = rollU32(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0);
    expect(Number.isInteger(u)).toBe(true);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(0xffffffff);
  });

  it("matches manual little-endian decoding of rollBytes()[0..4]", () => {
    const b = rollBytes(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0);
    const expected =
      ((b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0);
    expect(rollU32(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0)).toBe(
      expected,
    );
  });
});

describe("damageBonus — bonus ∈ [0..3] from low 2 bits", () => {
  it("returns an integer in [0..3]", () => {
    for (let i = 0; i < 16; i++) {
      const b = damageBonus(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, i);
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(3);
    }
  });

  it("derives the bonus by AND-masking the u32 with 0x03", () => {
    const u = rollU32(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0);
    const expected = u & 0x03;
    expect(damageBonus(FAKE_STATE, FAKE_ACTION, ROLL_DOMAIN_ATK_BONUS, 0)).toBe(
      expected,
    );
  });
});

describe("damageAmount — frozen formula (frozen-contract item 4)", () => {
  it("returns max(1, atk - def + bonus)", () => {
    expect(damageAmount(5, 2, 0)).toBe(3);
    expect(damageAmount(5, 2, 3)).toBe(6);
    expect(damageAmount(5, 10, 3)).toBe(1); // floor at 1
    expect(damageAmount(2, 5, 0)).toBe(1); // negative result clamped to 1
  });

  it("never returns 0", () => {
    expect(damageAmount(0, 100, 0)).toBe(1);
  });
});

describe("clampHp — N7 clamp", () => {
  it("clamps at 0 when dmg ≥ hp", () => {
    expect(clampHp(5, 10)).toBe(0);
    expect(clampHp(5, 5)).toBe(0);
  });

  it("subtracts dmg from hp when hp > dmg", () => {
    expect(clampHp(10, 3)).toBe(7);
  });

  it("returns 0 (not negative) on huge dmg", () => {
    expect(clampHp(2, 100)).toBe(0);
  });

  it("zero dmg leaves hp unchanged", () => {
    expect(clampHp(5, 0)).toBe(5);
  });
});

describe("roll-domain registry constants", () => {
  it("exports the two Phase 3 frozen domain strings", () => {
    expect(ROLL_DOMAIN_ATK_BONUS).toBe("combat:atk-bonus");
    expect(ROLL_DOMAIN_COUNTER_BONUS).toBe("combat:counter-bonus");
  });

  it("both domains are 7-bit ASCII and within 31 bytes", () => {
    for (const d of [ROLL_DOMAIN_ATK_BONUS, ROLL_DOMAIN_COUNTER_BONUS]) {
      expect(d.length).toBeLessThanOrEqual(31);
      for (let i = 0; i < d.length; i++) {
        expect(d.charCodeAt(i)).toBeLessThan(128);
      }
    }
  });
});
