/**
 * Phase 5.A.2 keyboard input tests.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - The input layer produces `Action` descriptors per the Phase 1
 *     `Action` schema; keypress → `Action` is configuration, not
 *     schema, so no `ACTION_VERSION` bump is required.
 *
 * Default bindings (configuration):
 *   - ArrowUp / KeyW / KeyK    → { type: "move", dir: 0 }   N
 *   - ArrowRight / KeyD / KeyL → { type: "move", dir: 1 }   E
 *   - ArrowDown / KeyS / KeyJ  → { type: "move", dir: 2 }   S
 *   - ArrowLeft / KeyA / KeyH  → { type: "move", dir: 3 }   W
 *   - KeyE                     → { type: "move", dir: 4 }   NE
 *   - KeyC                     → { type: "move", dir: 5 }   SE
 *   - KeyZ                     → { type: "move", dir: 6 }   SW
 *   - KeyQ                     → { type: "move", dir: 7 }   NW
 *   - Space / Period           → { type: "wait" }
 *   - Period+shift / Greater   → { type: "descend" }
 *
 * The sim treats a `move` into an occupied cell as an attack per
 * Phase 3 contract (no separate attack key).
 */
import { describe, expect, it } from "vitest";
import {
  startKeyboard,
  DEFAULT_KEY_BINDINGS,
  keyEventToAction,
} from "../../src/input/keyboard";
import type { Action } from "../../src/core/encode";

type FakeKeyEvent = {
  readonly code: string;
  readonly key: string;
  readonly shiftKey?: boolean;
  preventDefault: () => void;
};

function ev(
  code: string,
  key: string = code,
  shiftKey = false,
): FakeKeyEvent {
  return {
    code,
    key,
    shiftKey,
    preventDefault: () => {
      /* no-op */
    },
  };
}

describe("keyEventToAction — default bindings", () => {
  it("ArrowUp → move N", () => {
    expect(keyEventToAction(ev("ArrowUp"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 0,
    });
  });
  it("ArrowRight → move E", () => {
    expect(
      keyEventToAction(ev("ArrowRight"), DEFAULT_KEY_BINDINGS),
    ).toEqual({ type: "move", dir: 1 });
  });
  it("ArrowDown → move S", () => {
    expect(keyEventToAction(ev("ArrowDown"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 2,
    });
  });
  it("ArrowLeft → move W", () => {
    expect(keyEventToAction(ev("ArrowLeft"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 3,
    });
  });
  it("KeyW → move N", () => {
    expect(keyEventToAction(ev("KeyW"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 0,
    });
  });
  it("KeyD → move E", () => {
    expect(keyEventToAction(ev("KeyD"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 1,
    });
  });
  it("KeyS → move S", () => {
    expect(keyEventToAction(ev("KeyS"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 2,
    });
  });
  it("KeyA → move W", () => {
    expect(keyEventToAction(ev("KeyA"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 3,
    });
  });
  it("KeyE → move NE", () => {
    expect(keyEventToAction(ev("KeyE"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 4,
    });
  });
  it("KeyC → move SE", () => {
    expect(keyEventToAction(ev("KeyC"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 5,
    });
  });
  it("KeyZ → move SW", () => {
    expect(keyEventToAction(ev("KeyZ"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 6,
    });
  });
  it("KeyQ → move NW", () => {
    expect(keyEventToAction(ev("KeyQ"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "move",
      dir: 7,
    });
  });
  it("Space → wait", () => {
    expect(keyEventToAction(ev("Space"), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "wait",
    });
  });
  it("Period (no shift) → wait", () => {
    expect(keyEventToAction(ev("Period", "."), DEFAULT_KEY_BINDINGS)).toEqual({
      type: "wait",
    });
  });
  it("Period+shift → descend", () => {
    expect(
      keyEventToAction(ev("Period", ">", true), DEFAULT_KEY_BINDINGS),
    ).toEqual({ type: "descend" });
  });
  it("unknown key → null", () => {
    expect(keyEventToAction(ev("KeyX"), DEFAULT_KEY_BINDINGS)).toBeNull();
  });
});

describe("startKeyboard — event listener wiring", () => {
  function makeFakeTarget(): {
    target: EventTarget;
    listeners: Map<string, EventListener[]>;
  } {
    const listeners = new Map<string, EventListener[]>();
    const target: EventTarget = {
      addEventListener(type: string, listener: EventListener) {
        const arr = listeners.get(type) ?? [];
        arr.push(listener);
        listeners.set(type, arr);
      },
      removeEventListener(type: string, listener: EventListener) {
        const arr = listeners.get(type) ?? [];
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
      },
      dispatchEvent() {
        return true;
      },
    };
    return { target, listeners };
  }

  it("invokes onAction for each recognized key event", () => {
    const { target, listeners } = makeFakeTarget();
    const actions: Action[] = [];
    startKeyboard(
      { bindings: DEFAULT_KEY_BINDINGS, target },
      (a) => actions.push(a),
    );
    const handler = listeners.get("keydown")![0]!;
    handler(ev("ArrowUp") as unknown as Event);
    handler(ev("Space") as unknown as Event);
    expect(actions).toEqual([
      { type: "move", dir: 0 },
      { type: "wait" },
    ]);
  });

  it("ignores unrecognized key events without invoking onAction", () => {
    const { target, listeners } = makeFakeTarget();
    const actions: Action[] = [];
    startKeyboard(
      { bindings: DEFAULT_KEY_BINDINGS, target },
      (a) => actions.push(a),
    );
    const handler = listeners.get("keydown")![0]!;
    handler(ev("F12") as unknown as Event);
    expect(actions).toEqual([]);
  });

  it("returns a stop function that unsubscribes", () => {
    const { target, listeners } = makeFakeTarget();
    const actions: Action[] = [];
    const stop = startKeyboard(
      { bindings: DEFAULT_KEY_BINDINGS, target },
      (a) => actions.push(a),
    );
    expect(listeners.get("keydown")!.length).toBe(1);
    stop();
    expect(listeners.get("keydown")!.length).toBe(0);
  });

  it("calls preventDefault on recognized events (so the page doesn't scroll)", () => {
    const { target, listeners } = makeFakeTarget();
    startKeyboard(
      { bindings: DEFAULT_KEY_BINDINGS, target },
      () => {
        /* no-op */
      },
    );
    const handler = listeners.get("keydown")![0]!;
    let prevented = 0;
    const e: FakeKeyEvent = {
      code: "ArrowUp",
      key: "ArrowUp",
      preventDefault: () => {
        prevented++;
      },
    };
    handler(e as unknown as Event);
    expect(prevented).toBe(1);
  });
});

describe("startKeyboard — custom bindings", () => {
  it("respects a custom binding map", () => {
    const customBindings = {
      KeyB: { type: "wait" } as const,
    };
    const action = keyEventToAction(ev("KeyB"), customBindings);
    expect(action).toEqual({ type: "wait" });
    // Default bindings no longer apply.
    expect(keyEventToAction(ev("ArrowUp"), customBindings)).toBeNull();
  });

  it("recognizes the literal '>' key value (non-Period descend keys)", () => {
    // Some keyboard layouts emit code: "Greater" / key: ">" without a
    // shift modifier on the underlying event. The resolver should
    // accept either path.
    expect(
      keyEventToAction(ev("Greater", ">"), DEFAULT_KEY_BINDINGS),
    ).toEqual({ type: "descend" });
  });
});

describe("startKeyboard — fallback target", () => {
  it("throws if no target is supplied and `window` is undefined", () => {
    const savedWindow = (globalThis as Record<string, unknown>)["window"];
    delete (globalThis as Record<string, unknown>)["window"];
    try {
      expect(() =>
        startKeyboard(
          { bindings: DEFAULT_KEY_BINDINGS },
          () => {
            /* noop */
          },
        ),
      ).toThrow(/no event target supplied/);
    } finally {
      if (savedWindow !== undefined) {
        (globalThis as Record<string, unknown>)["window"] = savedWindow;
      }
    }
  });

  it("uses globalThis.window when no target is supplied", () => {
    const listeners = new Map<string, EventListener[]>();
    const fakeWindow: EventTarget = {
      addEventListener(type: string, listener: EventListener) {
        const arr = listeners.get(type) ?? [];
        arr.push(listener);
        listeners.set(type, arr);
      },
      removeEventListener() {
        // no-op
      },
      dispatchEvent() {
        return true;
      },
    };
    const savedWindow = (globalThis as Record<string, unknown>)["window"];
    (globalThis as Record<string, unknown>)["window"] = fakeWindow;
    try {
      const stop = startKeyboard(
        { bindings: DEFAULT_KEY_BINDINGS },
        () => {
          /* noop */
        },
      );
      expect(listeners.get("keydown")?.length ?? 0).toBe(1);
      stop();
    } finally {
      if (savedWindow === undefined) {
        delete (globalThis as Record<string, unknown>)["window"];
      } else {
        (globalThis as Record<string, unknown>)["window"] = savedWindow;
      }
    }
  });
});
