/**
 * Phase 5.A.2 keyboard input — `startKeyboard(config, onAction)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The input layer maps keypress events to Phase 1 `Action`
 *     descriptors. The mapping is **configuration**, not schema, so
 *     rebinding does not bump `ACTION_VERSION` or `rulesetVersion` —
 *     the produced `Action` bytes are unchanged.
 *   - The input layer is a peer of `src/render/**` and `src/ui/**` and
 *     has the same write-path bans (no `src/sim/turn.ts`,
 *     `src/sim/run.ts`, `src/sim/combat.ts`, `src/core/streams.ts`).
 *   - Only `src/main.ts` is the orchestrator that wires `onAction` into
 *     `tick(state, action)`.
 *   - Input-event timestamps (`event.timeStamp`) are untrusted by the
 *     sim and not stored on the state-hash chain (per the Phase 5
 *     frozen contract layer-table note: "no time except for input-event
 *     timestamps").
 *
 * Default bindings:
 *
 *   ArrowUp    / KeyW / KeyK   → move N  (dir 0)
 *   ArrowRight / KeyD / KeyL   → move E  (dir 1)
 *   ArrowDown  / KeyS / KeyJ   → move S  (dir 2)
 *   ArrowLeft  / KeyA / KeyH   → move W  (dir 3)
 *   KeyE                       → move NE (dir 4)
 *   KeyC                       → move SE (dir 5)
 *   KeyZ                       → move SW (dir 6)
 *   KeyQ                       → move NW (dir 7)
 *   Space                      → wait
 *   Period (no shift)          → wait
 *   Period (shift) / >         → descend
 *
 * Adjacent attack: when the player attempts to move into an occupied
 * cell, the sim's `tick` resolves the move-into-occupied-cell as the
 * defensive case (Phase 3 contract: collision short-circuits to
 * unchanged player position; player explicitly initiates `attack` via a
 * separate vocabulary entry, but the keybindings here ship `move` only
 * — bumping the player into a monster is a no-op until Phase 6 wires a
 * dedicated attack key. Phase 5 ships only the navigation surface.).
 */

import type { Action, Direction } from "../core/encode";

export type ActionTemplate = Action;

/**
 * Maps `KeyboardEvent.code` → `Action`. The runtime check
 * (`keyEventToAction`) also handles the Period/Greater shift dance for
 * the descend key.
 */
export type KeyBindings = Readonly<Record<string, ActionTemplate>>;

/**
 * Default bindings (rebindable via `KeyboardConfig.bindings`).
 *
 * Note: `Period` shows up twice in the natural mapping (`.` for wait,
 * `>` for descend). The `keyEventToAction` resolver special-cases
 * `Period+shift` → descend; the bindings table itself stores the
 * unshifted variant (wait). The mnemonic ">" is also bound directly
 * for keyboards that emit `code: "Period"` with `key: ">"` consistently.
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  ArrowUp: { type: "move", dir: 0 as Direction },
  ArrowRight: { type: "move", dir: 1 as Direction },
  ArrowDown: { type: "move", dir: 2 as Direction },
  ArrowLeft: { type: "move", dir: 3 as Direction },
  KeyW: { type: "move", dir: 0 as Direction },
  KeyD: { type: "move", dir: 1 as Direction },
  KeyS: { type: "move", dir: 2 as Direction },
  KeyA: { type: "move", dir: 3 as Direction },
  KeyK: { type: "move", dir: 0 as Direction },
  KeyL: { type: "move", dir: 1 as Direction },
  KeyJ: { type: "move", dir: 2 as Direction },
  KeyH: { type: "move", dir: 3 as Direction },
  KeyE: { type: "move", dir: 4 as Direction },
  KeyC: { type: "move", dir: 5 as Direction },
  KeyZ: { type: "move", dir: 6 as Direction },
  KeyQ: { type: "move", dir: 7 as Direction },
  Space: { type: "wait" },
  Period: { type: "wait" },
});

/**
 * The "code"/"key"/"shiftKey" subset of `KeyboardEvent` the resolver
 * actually reads. Lets unit tests pass plain object literals without
 * spinning up jsdom.
 */
type KeyEventLike = {
  readonly code: string;
  readonly key: string;
  readonly shiftKey?: boolean;
};

/**
 * Resolve a single key event into an `Action` descriptor, or `null` if
 * the key is not bound. The Period+shift → descend special-case is
 * applied here so the bindings table can stay flat.
 */
export function keyEventToAction(
  ev: KeyEventLike,
  bindings: KeyBindings,
): Action | null {
  // Special-case the descend key. Either a shifted Period (US-layout
  // physical `>`) or an explicit "Greater" / ">" key value resolves to
  // descend. Phase 5 does not include `Period` → descend in the table
  // (it shadows the wait binding); the resolver handles the modifier
  // dance inline.
  if (ev.code === "Period" && ev.shiftKey === true) {
    return { type: "descend" };
  }
  if (ev.key === ">") {
    return { type: "descend" };
  }
  const tmpl = bindings[ev.code];
  if (tmpl === undefined) return null;
  // Return a fresh object so the bindings constant stays
  // tamper-evident (callers cannot accidentally mutate the binding
  // template via the returned action object).
  if (tmpl.dir !== undefined) {
    return { type: tmpl.type, dir: tmpl.dir };
  }
  return { type: tmpl.type };
}

export type KeyboardConfig = {
  readonly bindings: KeyBindings;
  /**
   * Event target to bind on. Defaults to `window` in the browser; tests
   * pass a fake target to avoid jsdom.
   */
  readonly target?: EventTarget;
};

/**
 * Subscribe to keypress events on the configured target. Returns an
 * `unsubscribe()` function. Passes recognized events through
 * `keyEventToAction`; calls `preventDefault()` on those events so the
 * page does not scroll on arrow keys.
 *
 * Pure handler — no shared state, no side effects beyond the listener
 * registration. Multiple `startKeyboard` calls on the same target are
 * legal and additive (each gets its own callback).
 */
export function startKeyboard(
  config: KeyboardConfig,
  onAction: (action: Action) => void,
): () => void {
  const target =
    config.target ??
    (typeof window !== "undefined" ? (window as EventTarget) : undefined);
  if (target === undefined) {
    throw new Error(
      "startKeyboard: no event target supplied and `window` is undefined",
    );
  }
  const handler = (raw: Event) => {
    const ev = raw as unknown as KeyEventLike & { preventDefault: () => void };
    const action = keyEventToAction(ev, config.bindings);
    if (action === null) return;
    if (typeof ev.preventDefault === "function") {
      ev.preventDefault();
    }
    onAction(action);
  };
  target.addEventListener("keydown", handler);
  return () => {
    target.removeEventListener("keydown", handler);
  };
}
