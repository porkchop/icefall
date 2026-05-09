/**
 * Phase 9.A.2 title-screen UI tests. The title screen renders before
 * the playable game on the bare URL (no seed source); the buttons
 * navigate to a seed-bearing URL via the `onNewRun` /
 * `onRandomSeed` / `onPasteFingerprint` callbacks.
 *
 * The tests mirror the Phase 7.A.2 win-screen + Phase 6.A.2
 * inventory test patterns: a fake DOM mock (extended with
 * `addEventListener` + `style` + `focus` for 9.A.2's interactive
 * surface) is installed at module scope; tests inspect the DOM
 * shape and exercise the click/keydown handlers.
 */

import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
} from "vitest";
import { renderTitleScreen } from "../../src/ui/title-screen";
import { installFakeDocument, restoreDocument, FakeElement } from "./fake-dom";

/**
 * `host.querySelector("...")` returns the WHATWG `Element | null`
 * type, but at runtime (under `installFakeDocument`) it returns a
 * `FakeElement`. This helper does the unchecked cast so tests can
 * read `.value`, `.dispatch(...)`, etc. without per-call casts.
 */
function q(host: unknown, selector: string): FakeElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (host as any).querySelector(selector);
  if (el === null) throw new Error(`q: selector ${selector} not found`);
  return el as FakeElement;
}

/**
 * `document.createElement(...)` returns `HTMLDivElement` per the
 * WHATWG types. At runtime it's a `FakeElement` (under the fake
 * document). Cast for tests that pass the host into renderTitleScreen.
 */
function makeHost(): HTMLElement {
  // At runtime under installFakeDocument(), this is a FakeElement;
  // the WHATWG type lets us pass it to renderTitleScreen unchanged.
  return document.createElement("div");
}

beforeAll(() => {
  installFakeDocument();
});
afterAll(() => {
  restoreDocument();
});

const TODAY = "2026-05-09";

function makeOptions(overrides: Partial<Parameters<typeof renderTitleScreen>[1]> = {}) {
  return {
    defaultSeed: TODAY,
    todayDate: TODAY,
    onNewRun: () => {
      /* no-op */
    },
    onRandomSeed: () => {
      /* no-op */
    },
    onPasteFingerprint: () => {
      /* no-op */
    },
    ...overrides,
  };
}

describe("renderTitleScreen — DOM structure", () => {
  it("builds the heading + subtitle + seed input + 3 buttons + paste row + footer", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions());
    const text = host.textContent ?? "";
    expect(text).toContain("ICEFALL");
    expect(text).toContain("Deterministic-shareable cyberpunk roguelike");
    expect(text).toContain("Seed");
    expect(text).toContain("New Run");
    expect(text).toContain(`Random Seed (today: ${TODAY})`);
    expect(text).toContain("Paste Fingerprint");
    expect(text).toContain("Tab to navigate");
  });

  it("pre-fills the seed input with the defaultSeed option", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions({ defaultSeed: "alpha-1" }));
    const input = q(host, "[data-ui-field='seed-input']");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("alpha-1");
  });

  it("adds the 'title-screen' class to the host on first render", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions());
    expect(host.className).toContain("title-screen");
  });

  it("creates the New Run button as the primary action (extra class)", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions());
    const btn = q(host, "[data-ui-field='new-run-button']");
    expect(btn).not.toBeNull();
    expect(btn!.className).toContain("title-screen-button-primary");
  });
});

describe("renderTitleScreen — handlers", () => {
  it("calls onNewRun with the seed input value when New Run is clicked", () => {
    const host = makeHost();
    let received: string | null = null;
    renderTitleScreen(
      host,
      makeOptions({
        onNewRun: (seed) => {
          received = seed;
        },
      }),
    );
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "phase-9-test-seed";
    const btn = q(host, "[data-ui-field='new-run-button']");
    btn!.dispatch("click");
    expect(received).toBe("phase-9-test-seed");
  });

  it("trims whitespace from the seed input value", () => {
    const host = makeHost();
    let received: string | null = null;
    renderTitleScreen(
      host,
      makeOptions({
        onNewRun: (seed) => {
          received = seed;
        },
      }),
    );
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "  alpha-1  ";
    const btn = q(host, "[data-ui-field='new-run-button']");
    btn!.dispatch("click");
    expect(received).toBe("alpha-1");
  });

  it("does NOT call onNewRun when the seed input is empty", () => {
    const host = makeHost();
    let calls = 0;
    renderTitleScreen(
      host,
      makeOptions({
        onNewRun: () => {
          calls++;
        },
      }),
    );
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "";
    const btn = q(host, "[data-ui-field='new-run-button']");
    btn!.dispatch("click");
    expect(calls).toBe(0);
  });

  it("activates New Run when Enter is pressed on the seed input", () => {
    const host = makeHost();
    let received: string | null = null;
    renderTitleScreen(
      host,
      makeOptions({
        onNewRun: (seed) => {
          received = seed;
        },
      }),
    );
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "alpha-1";
    let preventDefaultCalled = false;
    input!.dispatch("keydown", {
      key: "Enter",
      preventDefault: () => {
        preventDefaultCalled = true;
      },
    });
    expect(received).toBe("alpha-1");
    expect(preventDefaultCalled).toBe(true);
  });

  it("ignores non-Enter keys on the seed input", () => {
    const host = makeHost();
    let calls = 0;
    renderTitleScreen(
      host,
      makeOptions({
        onNewRun: () => {
          calls++;
        },
      }),
    );
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "alpha-1";
    input!.dispatch("keydown", {
      key: "a",
      preventDefault: () => {
        /* no-op */
      },
    });
    expect(calls).toBe(0);
  });

  it("calls onRandomSeed with the todayDate option when Random Seed is clicked", () => {
    const host = makeHost();
    let received: string | null = null;
    renderTitleScreen(
      host,
      makeOptions({
        todayDate: "2026-12-25",
        onRandomSeed: (s) => {
          received = s;
        },
      }),
    );
    const btn = q(host, "[data-ui-field='random-seed-button']");
    btn!.dispatch("click");
    expect(received).toBe("2026-12-25");
  });

  it("updates the seed input value when Random Seed is clicked", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions({ todayDate: "2026-07-04" }));
    const input = q(host, "[data-ui-field='seed-input']");
    const btn = q(host, "[data-ui-field='random-seed-button']");
    btn!.dispatch("click");
    expect(input!.value).toBe("2026-07-04");
  });

  it("calls onPasteFingerprint with the textarea value when Paste flow is submitted", () => {
    const host = makeHost();
    let received: string | null = null;
    renderTitleScreen(
      host,
      makeOptions({
        onPasteFingerprint: (s) => {
          received = s;
        },
      }),
    );
    const pasteInput = q(host, "[data-ui-field='paste-fp-input']");
    pasteInput!.value = "https://porkchop.github.io/icefall/?run=ABC&seed=x";
    // The submit button is created without a data-ui-field but is the
    // last child of the paste row. The fake DOM doesn't support :last
    // pseudo-classes; instead we walk the tree to find a button whose
    // textContent is "Open pasted run".
    function findSubmit(node: FakeElement): FakeElement | null {
      for (const c of node.children) {
        if (c.tagName === "BUTTON" && c.textContent === "Open pasted run") {
          return c;
        }
        const deeper = findSubmit(c);
        if (deeper !== null) return deeper;
      }
      return null;
    }
    const submit = findSubmit(host as unknown as FakeElement);
    submit!.dispatch("click");
    expect(received).toBe(
      "https://porkchop.github.io/icefall/?run=ABC&seed=x",
    );
  });

  it("does NOT call onPasteFingerprint when the textarea is empty", () => {
    const host = makeHost();
    let calls = 0;
    renderTitleScreen(
      host,
      makeOptions({
        onPasteFingerprint: () => {
          calls++;
        },
      }),
    );
    function findSubmit(node: FakeElement): FakeElement | null {
      for (const c of node.children) {
        if (c.tagName === "BUTTON" && c.textContent === "Open pasted run") {
          return c;
        }
        const deeper = findSubmit(c);
        if (deeper !== null) return deeper;
      }
      return null;
    }
    const submit = findSubmit(host as unknown as FakeElement);
    submit!.dispatch("click");
    expect(calls).toBe(0);
  });
});

describe("renderTitleScreen — idempotent re-render", () => {
  it("does not duplicate DOM nodes on a second render call", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions());
    const firstChildCount = host.children.length;
    renderTitleScreen(host, makeOptions());
    const secondChildCount = host.children.length;
    expect(secondChildCount).toBe(firstChildCount);
  });

  it("updates the random-seed button label across midnight UTC", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions({ todayDate: "2026-05-09" }));
    let btn = q(host, "[data-ui-field='random-seed-button']");
    expect(btn!.textContent).toContain("2026-05-09");
    renderTitleScreen(host, makeOptions({ todayDate: "2026-05-10" }));
    btn = q(host, "[data-ui-field='random-seed-button']");
    expect(btn!.textContent).toContain("2026-05-10");
  });

  it("preserves the user-typed seed input value across re-renders", () => {
    const host = makeHost();
    renderTitleScreen(host, makeOptions({ defaultSeed: "default-seed" }));
    const input = q(host, "[data-ui-field='seed-input']");
    input!.value = "user-typed-seed";
    renderTitleScreen(host, makeOptions({ defaultSeed: "different-default" }));
    expect(input!.value).toBe("user-typed-seed");
  });
});
