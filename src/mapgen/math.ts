/**
 * Re-export of integer arithmetic helpers. The implementations live in
 * `src/core/intmath.ts` (Phase 4.A.2 relocation, mirroring Phase 4.A.1's
 * `uniformIndex` relocation) so `src/atlas/**` can consume them without
 * a forbidden cross-layer import. Pre-existing `src/mapgen/**` callers
 * keep their `./math` import path.
 */

export { idiv, imod } from "../core/intmath";
