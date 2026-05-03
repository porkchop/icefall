/**
 * Place a room inside a BSP leaf. The room sits strictly inside the
 * leaf, with `ROOM_PADDING` tiles of margin on every side, and its
 * dimensions are sampled from the kind's `[minWidth, maxWidth] x
 * [minHeight, maxHeight]` window clamped to what the leaf can hold.
 *
 * Deterministic from the PRNG. No floats, no `Math.*`, no time inputs.
 */

import type { PRNG } from "../core/prng";
import type { Rect } from "./types";
import { getRoomKind, type RoomKindId } from "../registries/rooms";
import { ROOM_PADDING } from "./params";
import { uniformU32 } from "./bsp";

/**
 * Place a room rectangle inside a leaf rectangle. Throws if the leaf
 * cannot host the room kind's minimum dimensions plus padding on each
 * side.
 */
export function placeRoomInLeaf(
  leaf: Rect,
  prng: PRNG,
  kindId: RoomKindId,
): Rect {
  const kind = getRoomKind(kindId);
  const innerW = leaf.w - ROOM_PADDING * 2;
  const innerH = leaf.h - ROOM_PADDING * 2;
  if (innerW < kind.minWidth || innerH < kind.minHeight) {
    throw new Error(
      `placeRoomInLeaf: leaf ${leaf.w}x${leaf.h} too small for kind ${kindId} (min ${kind.minWidth}x${kind.minHeight} + padding ${ROOM_PADDING})`,
    );
  }

  const maxW = innerW < kind.maxWidth ? innerW : kind.maxWidth;
  const maxH = innerH < kind.maxHeight ? innerH : kind.maxHeight;

  // Pick width / height uniformly in [min, max].
  const w = kind.minWidth + uniformU32(prng, maxW - kind.minWidth + 1);
  const h = kind.minHeight + uniformU32(prng, maxH - kind.minHeight + 1);

  // Pick a top-left corner uniformly in the leaf's interior region.
  const xSlack = innerW - w;
  const ySlack = innerH - h;
  const xOff = uniformU32(prng, xSlack + 1);
  const yOff = uniformU32(prng, ySlack + 1);

  return {
    x: leaf.x + ROOM_PADDING + xOff,
    y: leaf.y + ROOM_PADDING + yOff,
    w,
    h,
  };
}
