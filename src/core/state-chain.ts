import { sha256, utf8, concat } from "./hash";
import { encodeAction, type Action } from "./encode";

const GENESIS_DOMAIN = "icefall:state:v1:genesis";

let _genesis: Uint8Array | null = null;

export function genesis(): Uint8Array {
  if (_genesis === null) _genesis = sha256(utf8(GENESIS_DOMAIN));
  // Return a defensive copy so callers cannot mutate the cached digest.
  return _genesis.slice();
}

/**
 * Advance the state chain by one action. `state` must be 32 bytes.
 */
export function advance(state: Uint8Array, action: Action): Uint8Array {
  if (state.length !== 32) {
    throw new Error(`advance: state must be 32 bytes, got ${state.length}`);
  }
  return sha256(concat([state, encodeAction(action)]));
}

export { encodeAction, type Action };
