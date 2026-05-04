/**
 * Phase 4 PNG CRC-32 implementation (memo decision 4).
 *
 * Standard CRC-32 (IEEE 802.3) — reflected, polynomial `0xedb88320`,
 * initial value `0xffffffff`, final XOR `0xffffffff`. The `IEND`
 * chunk's well-known CRC `0xae426082` is the reference smoke test.
 *
 * The 256-entry lookup table is built lazily on first call and cached
 * for the lifetime of the module.
 */

let TABLE: Uint32Array | null = null;

function buildTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
    }
    t[n] = c >>> 0;
  }
  return t;
}

/**
 * Compute the CRC-32 of `bytes` per the PNG spec. Returns an unsigned
 * 32-bit integer (callers writing to a chunk should emit the four
 * bytes big-endian).
 */
export function crc32(bytes: Uint8Array): number {
  if (TABLE === null) TABLE = buildTable();
  const tbl = TABLE;
  let crc = 0xffffffff >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (tbl[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
