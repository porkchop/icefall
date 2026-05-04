/**
 * Tiny `document` mock for the HUD unit tests. Implements just the
 * surface `src/ui/hud.ts` touches: `createElement`, `appendChild`,
 * `classList.add`, `dataset`, `textContent`, `innerHTML`,
 * `querySelector` (with single-attribute selectors only).
 *
 * Centralized here so it can be reused by other UI tests if Phase 6+
 * widgets need it. Adding `jsdom` / `happy-dom` as a real dependency is
 * out of Phase 5.A.2 scope (the playable game is exercised end-to-end
 * by Playwright in `tests/e2e/diagnostic.spec.ts`).
 */

type FakeAttrSelector = { kind: "attr"; name: string; value: string };
type FakeSelector = FakeAttrSelector;

export class FakeElement {
  className = "";
  private _textContent = "";
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string>;
  readonly attributes = new Map<string, string>();
  readonly tagName: string;
  readonly classList: { add(c: string): void };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    const dataAttrs = this.attributes;
    this.dataset = new Proxy(
      {},
      {
        set(_t, prop: string, value: string) {
          dataAttrs.set(`data-${camelToKebab(prop)}`, value);
          return true;
        },
        get(_t, prop: string): string | undefined {
          return dataAttrs.get(`data-${camelToKebab(prop)}`);
        },
      },
    ) as Record<string, string>;
    this.classList = {
      add: (c: string) => {
        if (this.className === "") this.className = c;
        else if (!this.className.split(/\s+/).includes(c)) {
          this.className = `${this.className} ${c}`;
        }
      },
    };
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    // Setting textContent on an element with children replaces them
    // with a single text node. We approximate by clearing children
    // and storing the value.
    this.children.length = 0;
    this._textContent = v;
  }

  get innerHTML(): string {
    // Simple approximation — sufficient for the test that inspects
    // children-count via a snapshot.
    return this.children.map((c) => c.outerHTML()).join("");
  }
  set innerHTML(v: string) {
    if (v === "") {
      this.children.length = 0;
    }
  }

  outerHTML(): string {
    const attrs: string[] = [];
    if (this.className !== "") attrs.push(`class="${this.className}"`);
    for (const [k, v] of this.attributes) {
      attrs.push(`${k}="${v}"`);
    }
    const open =
      attrs.length > 0
        ? `<${this.tagName.toLowerCase()} ${attrs.join(" ")}>`
        : `<${this.tagName.toLowerCase()}>`;
    const inner =
      this.children.length > 0
        ? this.children.map((c) => c.outerHTML()).join("")
        : this._textContent;
    return `${open}${inner}</${this.tagName.toLowerCase()}>`;
  }

  querySelector<T extends FakeElement = FakeElement>(
    selector: string,
  ): T | null {
    const sel = parseSelector(selector);
    if (sel === null) return null;
    return this.queryFirst(sel) as T | null;
  }

  private queryFirst(sel: FakeSelector): FakeElement | null {
    for (const child of this.children) {
      if (selectorMatches(child, sel)) return child;
      const deeper = child.queryFirst(sel);
      if (deeper !== null) return deeper;
    }
    return null;
  }
}

function selectorMatches(el: FakeElement, sel: FakeSelector): boolean {
  if (sel.kind === "attr") {
    return el.attributes.get(sel.name) === sel.value;
  }
  return false;
}

function parseSelector(s: string): FakeSelector | null {
  // Accepts only `[name='value']` form, which is what the HUD tests use.
  const m = /^\[([a-zA-Z0-9-]+)='(.+)'\]$/.exec(s.trim());
  if (m === null) return null;
  return { kind: "attr", name: m[1]!, value: m[2]! };
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

let saved: unknown = undefined;
let installed = false;

export function installFakeDocument(): void {
  if (installed) return;
  saved = (globalThis as Record<string, unknown>)["document"];
  (globalThis as Record<string, unknown>)["document"] = new FakeDocument();
  installed = true;
}

export function restoreDocument(): void {
  if (!installed) return;
  (globalThis as Record<string, unknown>)["document"] = saved;
  installed = false;
}
