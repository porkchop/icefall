/**
 * Monster registry — frozen content from Phase 3 decision memo
 * decision 12. Six monster kinds + one boss; integer-only stats.
 * Stable string IDs from day one (SPEC.md principle 5). Phase 6 / 7
 * may add monsters; removing or renaming a kind is a `rulesetVersion`
 * bump.
 */

export type MonsterKindId =
  | "monster.ice.daemon"
  | "monster.ice.spider"
  | "monster.corp.sec-rookie"
  | "monster.corp.sec-veteran"
  | "monster.drone.sentry"
  | "monster.gang.razorgirl"
  | "monster.boss.black-ice-v0";

export type MonsterKind = {
  readonly id: MonsterKindId;
  readonly hpMax: number;
  readonly atk: number;
  readonly def: number;
  readonly allowedFloors: readonly number[];
  readonly isBoss: boolean;
};

const FLOORS_1_TO_3: readonly number[] = Object.freeze([1, 2, 3]);
const FLOORS_2_TO_5: readonly number[] = Object.freeze([2, 3, 4, 5]);
const FLOORS_3_TO_6: readonly number[] = Object.freeze([3, 4, 5, 6]);
const FLOORS_4_TO_9: readonly number[] = Object.freeze([4, 5, 6, 7, 8, 9]);
const FLOORS_5_TO_9: readonly number[] = Object.freeze([5, 6, 7, 8, 9]);
const FLOORS_6_TO_9: readonly number[] = Object.freeze([6, 7, 8, 9]);
const FLOOR_10: readonly number[] = Object.freeze([10]);

function freezeKind(k: MonsterKind): MonsterKind {
  return Object.freeze({ ...k, allowedFloors: k.allowedFloors });
}

export const MONSTER_KINDS: readonly MonsterKind[] = Object.freeze([
  freezeKind({
    id: "monster.boss.black-ice-v0",
    hpMax: 40,
    atk: 9,
    def: 5,
    allowedFloors: FLOOR_10,
    isBoss: true,
  }),
  freezeKind({
    id: "monster.corp.sec-rookie",
    hpMax: 8,
    atk: 4,
    def: 2,
    allowedFloors: FLOORS_3_TO_6,
    isBoss: false,
  }),
  freezeKind({
    id: "monster.corp.sec-veteran",
    hpMax: 12,
    atk: 6,
    def: 3,
    allowedFloors: FLOORS_5_TO_9,
    isBoss: false,
  }),
  freezeKind({
    id: "monster.drone.sentry",
    hpMax: 9,
    atk: 5,
    def: 1,
    allowedFloors: FLOORS_4_TO_9,
    isBoss: false,
  }),
  freezeKind({
    id: "monster.gang.razorgirl",
    hpMax: 14,
    atk: 7,
    def: 4,
    allowedFloors: FLOORS_6_TO_9,
    isBoss: false,
  }),
  freezeKind({
    id: "monster.ice.daemon",
    hpMax: 4,
    atk: 2,
    def: 0,
    allowedFloors: FLOORS_1_TO_3,
    isBoss: false,
  }),
  freezeKind({
    id: "monster.ice.spider",
    hpMax: 6,
    atk: 3,
    def: 1,
    allowedFloors: FLOORS_2_TO_5,
    isBoss: false,
  }),
]);

export const MONSTER_KIND_IDS: readonly MonsterKindId[] = Object.freeze(
  MONSTER_KINDS.map((k) => k.id),
);

export function getMonsterKind(id: string): MonsterKind {
  for (let i = 0; i < MONSTER_KINDS.length; i++) {
    const k = MONSTER_KINDS[i]!;
    if (k.id === id) return k;
  }
  throw new Error(`getMonsterKind: unknown monster kind id "${id}"`);
}

/**
 * Eligible monster kinds for a floor — sorted by id (deterministic
 * iteration order, since `MONSTER_KINDS` is itself sorted).
 * Excludes bosses (the boss spawn is handled by a dedicated boss-arena
 * placement, not the floor-eligibility filter).
 */
export function eligibleMonstersForFloor(
  floorN: number,
): readonly MonsterKind[] {
  const out: MonsterKind[] = [];
  for (let i = 0; i < MONSTER_KINDS.length; i++) {
    const k = MONSTER_KINDS[i]!;
    if (k.isBoss) continue;
    if (k.allowedFloors.includes(floorN)) out.push(k);
  }
  return out;
}
