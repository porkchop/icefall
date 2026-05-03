import { describe, expect, it } from "vitest";
import { serializeFloor, parseFloor } from "./serialize";
import type { Floor } from "./types";

function makeFloor(): Floor {
  return {
    floor: 1,
    width: 4,
    height: 3,
    tiles: new Uint8Array([0, 1, 2, 3, 1, 1, 1, 1, 0, 2, 1, 0]),
    rooms: [
      { id: 0, kind: "room.entrance", x: 0, y: 0, w: 2, h: 2 },
      { id: 1, kind: "room.exit", x: 2, y: 1, w: 2, h: 2 },
    ],
    doors: [
      { x: 1, y: 0 },
      { x: 0, y: 2 },
    ],
    encounters: [
      { kind: "encounter.combat.basic", x: 1, y: 1 },
      { kind: "encounter.loot.basic", x: 2, y: 2 },
    ],
    entrance: { x: 0, y: 0 },
    exit: { x: 3, y: 2 },
    bossArena: null,
  };
}

describe("serializeFloor", () => {
  it("emits top-level keys in alphabetical order with all values present", () => {
    const json = serializeFloor(makeFloor());
    const order: string[] = [];
    // Match top-level keys by parsing and re-checking key order via regex
    // on the raw string (top-level scope only).
    const m = json.match(/"([a-zA-Z]+)":/g);
    if (m) {
      let depth = 0;
      let i = 0;
      while (i < json.length) {
        const c = json[i]!;
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") depth--;
        else if (c === '"' && depth === 1) {
          // peek key
          const end = json.indexOf('"', i + 1);
          const key = json.slice(i + 1, end);
          // Top-level keys have a colon following the closing quote
          if (json.charAt(end + 1) === ":") order.push(key);
          i = end;
        }
        i++;
      }
    }
    expect(order).toEqual([
      "bossArena",
      "doors",
      "encounters",
      "entrance",
      "exit",
      "floor",
      "height",
      "rooms",
      "schemaVersion",
      "tilesB64",
      "tilesShape",
      "width",
    ]);
  });

  it("emits schemaVersion 1", () => {
    expect(serializeFloor(makeFloor())).toContain('"schemaVersion":1');
  });

  it("emits null for bossArena on floors 1..9 and exit object", () => {
    const json = serializeFloor(makeFloor());
    expect(json).toContain('"bossArena":null');
    expect(json).toContain('"exit":{"x":3,"y":2}');
  });

  it("sorts doors by (y, x)", () => {
    const f: Floor = {
      ...makeFloor(),
      doors: [
        { x: 5, y: 2 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    };
    const json = serializeFloor(f);
    const m = json.match(/"doors":\[(.*?)\]/)!;
    expect(m[1]).toBe('{"x":0,"y":1},{"x":1,"y":1},{"x":5,"y":2}');
  });

  it("sorts encounters by (kind, y, x)", () => {
    const f: Floor = {
      ...makeFloor(),
      encounters: [
        { kind: "encounter.loot.basic", x: 1, y: 1 },
        { kind: "encounter.combat.basic", x: 1, y: 2 },
        { kind: "encounter.combat.basic", x: 0, y: 2 },
      ],
    };
    const json = serializeFloor(f);
    const idx = json.indexOf('"encounters":[');
    const end = json.indexOf("]", idx);
    const slice = json.slice(idx, end + 1);
    expect(slice).toBe(
      '"encounters":[{"kind":"encounter.combat.basic","x":0,"y":2},{"kind":"encounter.combat.basic","x":1,"y":2},{"kind":"encounter.loot.basic","x":1,"y":1}]',
    );
  });

  it("sorts rooms by id", () => {
    const f: Floor = {
      ...makeFloor(),
      rooms: [
        { id: 1, kind: "room.exit", x: 0, y: 0, w: 2, h: 2 },
        { id: 0, kind: "room.entrance", x: 2, y: 1, w: 2, h: 2 },
      ],
    };
    const json = serializeFloor(f);
    expect(json.indexOf('"id":0')).toBeLessThan(json.indexOf('"id":1'));
  });

  it("encodes tiles as RFC 4648 §5 base64url, unpadded", () => {
    const f = makeFloor();
    const json = serializeFloor(f);
    const m = json.match(/"tilesB64":"([^"]*)"/)!;
    expect(m[1]).not.toContain("=");
    expect(m[1]).not.toContain("+");
    expect(m[1]).not.toContain("/");
    // tilesShape redundancy
    expect(json).toContain('"tilesShape":[4,3]');
  });

  it("emits boss-floor JSON with exit:null and a bossArena object", () => {
    const f: Floor = {
      ...makeFloor(),
      floor: 10,
      bossArena: { x: 5, y: 5, w: 20, h: 20 },
      exit: null,
    };
    const json = serializeFloor(f);
    expect(json).toContain('"bossArena":{"x":5,"y":5,"w":20,"h":20}');
    expect(json).toContain('"exit":null');
  });
});

describe("parseFloor (strict)", () => {
  it("round-trips serializeFloor output back to a structurally-equal Floor", () => {
    const f = makeFloor();
    const back = parseFloor(JSON.parse(serializeFloor(f)));
    expect(back.floor).toBe(f.floor);
    expect(back.width).toBe(f.width);
    expect(back.height).toBe(f.height);
    expect([...back.tiles]).toEqual([...f.tiles]);
    expect(back.rooms).toEqual(f.rooms);
    expect(back.entrance).toEqual(f.entrance);
    expect(back.exit).toEqual(f.exit);
    expect(back.bossArena).toEqual(f.bossArena);
  });

  it("rejects unknown top-level keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.extra = 123;
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects missing required keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    delete obj.entrance;
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects schemaVersion != 1", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.schemaVersion = 2;
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects floors where both bossArena and exit are null", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.exit = null;
    obj.bossArena = null;
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects floors where both bossArena and exit are non-null", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.bossArena = { x: 0, y: 0, w: 16, h: 16 };
    obj.exit = { x: 1, y: 1 };
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects mismatched tilesShape vs decoded tiles length", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.tilesShape = [10, 10];
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects non-object input", () => {
    expect(() => parseFloor(null)).toThrow();
    expect(() => parseFloor(42)).toThrow();
    expect(() => parseFloor("not a floor")).toThrow();
  });

  it("rejects malformed array entries (e.g. non-integer door coords)", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.doors = [{ x: 0.5, y: 0 }];
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects unknown encounter kind ids", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.encounters = [{ kind: "encounter.bogus", x: 0, y: 0 }];
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects unknown room kind ids", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.rooms = [{ id: 0, kind: "room.unknown", x: 0, y: 0, w: 2, h: 2 }];
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects malformed tilesB64 (invalid char)", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.tilesB64 = "@@@@";
    expect(() => parseFloor(obj)).toThrow();
  });

  it("decodes base64url tilesB64 of length mod 4 == 2 (1-byte tile grid)", () => {
    // 1×1 floor: 1 tile byte → 2 base64 chars → r=2
    const tiny: Floor = {
      floor: 1,
      width: 1,
      height: 1,
      tiles: new Uint8Array([1]),
      rooms: [{ id: 0, kind: "room.entrance", x: 0, y: 0, w: 1, h: 1 }],
      doors: [],
      encounters: [],
      entrance: { x: 0, y: 0 },
      exit: { x: 0, y: 0 },
      bossArena: null,
    };
    const back = parseFloor(JSON.parse(serializeFloor(tiny)));
    expect([...back.tiles]).toEqual([1]);
  });

  it("decodes base64url tilesB64 of length mod 4 == 3 (2-byte tile grid)", () => {
    // 1×2 floor: 2 tile bytes → 3 base64 chars → r=3
    const tiny: Floor = {
      floor: 1,
      width: 1,
      height: 2,
      tiles: new Uint8Array([1, 2]),
      rooms: [{ id: 0, kind: "room.entrance", x: 0, y: 0, w: 1, h: 2 }],
      doors: [],
      encounters: [],
      entrance: { x: 0, y: 0 },
      exit: { x: 0, y: 1 },
      bossArena: null,
    };
    const back = parseFloor(JSON.parse(serializeFloor(tiny)));
    expect([...back.tiles]).toEqual([1, 2]);
  });

  it("rejects tilesB64 of illegal length mod 4 == 1", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    // 5-character base64url is mod 4 == 1, structurally illegal
    obj.tilesB64 = "AAAAA";
    expect(() => parseFloor(obj)).toThrow();
  });

  it("rejects rooms entries that are not objects", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.rooms = [42];
    expect(() => parseFloor(obj)).toThrow(/rooms\[0\] must be object/);
  });

  it("rejects rooms entries with unexpected keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.rooms = [
      { id: 0, kind: "room.entrance", x: 0, y: 0, w: 2, h: 2, extraneous: 1 },
    ];
    expect(() => parseFloor(obj)).toThrow(/unexpected key/);
  });

  it("rejects encounters entries that are not objects", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.encounters = [42];
    expect(() => parseFloor(obj)).toThrow(/encounters\[0\] must be object/);
  });

  it("rejects encounters entries with unexpected keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.encounters = [{ kind: "encounter.combat.basic", x: 0, y: 0, extra: 1 }];
    expect(() => parseFloor(obj)).toThrow(/unexpected key/);
  });

  it("rejects doors entries that are not objects", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.doors = [42];
    expect(() => parseFloor(obj)).toThrow(/doors\[0\]/);
  });

  it("rejects bossArena that is not an object", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.bossArena = 42;
    obj.exit = null;
    obj.floor = 10;
    expect(() => parseFloor(obj)).toThrow(/bossArena/);
  });

  it("rejects bossArena with unexpected keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.bossArena = { x: 0, y: 0, w: 16, h: 16, extra: 1 };
    obj.exit = null;
    obj.floor = 10;
    expect(() => parseFloor(obj)).toThrow(/unexpected key/);
  });

  it("rejects entrance with unexpected keys", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.entrance = { x: 0, y: 0, extra: 1 };
    expect(() => parseFloor(obj)).toThrow(/unexpected key/);
  });

  it("rejects tilesB64 that is not a string", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    obj.tilesB64 = 42;
    expect(() => parseFloor(obj)).toThrow(/tilesB64 must be a string/);
  });

  it("rejects decoded tile count != width*height", () => {
    const f = makeFloor();
    const obj = JSON.parse(serializeFloor(f));
    // Substitute a tilesB64 that decodes to a different number of bytes.
    // Original is 12 tiles (4 bytes per quad → 16 chars → 12 bytes).
    // Replace with 8 chars (= 6 bytes).
    obj.tilesB64 = "AAAAAAAA";
    expect(() => parseFloor(obj)).toThrow(/decoded tile count/);
  });
});
