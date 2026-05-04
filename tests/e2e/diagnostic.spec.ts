import { test, expect } from "@playwright/test";

const RANDOM_WALK_DIGEST =
  "142c5ee954cbcd40ea846f00c117bb59828bd61256729b2079c875d2c85dbac4";

const SIM_DIGEST =
  "321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e";

// Phase 6.A.2 — atlas regenerated with the expanded item registry.
// Existing 7 Phase 4 sprite coordinates are unchanged; new sprites
// append. The new ATLAS_DIGEST replaces the Phase 4 golden literally
// here per memo addendum N12.
const ATLAS_DIGEST =
  "35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47";

// Phase 4 preset-seed expectedHash values (memo addendum N12). Pinned
// in `src/atlas/preset-seeds.ts` and re-asserted here for the live
// browser environment. Bumped to the new bytes in Phase 6.A.2.
const PRESET_HASHES: { id: string; seed: string; expectedHash: string }[] = [
  {
    id: "placeholder",
    seed: "icefall-phase4-placeholder-atlas-seed",
    expectedHash:
      "35069834850591c6b72c1946629129a04ed2f1b9446de5ccdd75b28fe6005a47",
  },
  {
    id: "variant-A",
    seed: "icefall-atlas-variant-A",
    expectedHash:
      "c3dc8c8b50592e2c7383d2cafd02d2932afd27a1f898bea9aadc82a5299c7396",
  },
  {
    id: "variant-B",
    seed: "icefall-atlas-variant-B",
    expectedHash:
      "405713dfbbbc9b57e2ee3e08b47abe6436d3199ceb2613b602829532bbeef0f8",
  },
  {
    id: "variant-C",
    seed: "icefall-atlas-variant-C",
    expectedHash:
      "f77e1a28d6cfe0452ab790503996e787f46a240b2818d8adc1dedfadadbef01c",
  },
];

test("diagnostic page reports self-test green", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#self-test-banner")).toHaveAttribute(
    "data-status",
    "green",
    { timeout: 10_000 },
  );
  const result = await page.evaluate(() => window.__SELF_TEST_RESULT__);
  expect(result).toBe("green");
});

test("cross-runtime random-walk digest matches the golden constant", async ({
  page,
}) => {
  await page.goto("/");
  const details = await page.evaluate(() => window.__SELF_TEST_DETAILS__);
  expect(details).toBeTruthy();
  expect(details!.ok).toBe(true);
  expect(details!.failures).toEqual([]);
});

test("diagnostic page renders build info with derived (non-placeholder) ruleset", async ({
  page,
}) => {
  await page.goto("/");
  const banner = page.locator("#self-test-banner");
  await expect(banner).toBeVisible();
  await expect(page.getByText("commitHash")).toBeVisible();
  await expect(page.getByText("rulesetVersion")).toBeVisible();
  // Phase 4.A.2 atomic flip (addendum B1): the placeholder is retired
  // and `rulesetVersion` is the derived `sha256(rulesText ‖
  // atlasBinaryHash)` value. Sample fingerprint is therefore NOT
  // DEV-prefixed.
  const fingerprintText = await page
    .locator(".build-meta dd")
    .nth(2)
    .innerText();
  expect(fingerprintText.startsWith("DEV-")).toBe(false);
  expect(fingerprintText.length).toBeGreaterThan(0);
});

test("computed walk digest matches the Node-side constant", async ({
  page,
}) => {
  await page.goto("/");
  const digest = await page.evaluate(() => window.__RANDOM_WALK_DIGEST__);
  expect(digest).toBe(RANDOM_WALK_DIGEST);
});

test("floor preview UI is ready and renders an ASCII grid", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#floor-preview")).toBeVisible();
  // Wait for the in-page initial render to set the readiness flag.
  await page.waitForFunction(
    () => window.__FLOOR_PREVIEW__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const seedInput = page.locator("#preview-seed");
  await expect(seedInput).toBeVisible();
  const ascii = await page.locator("#floor-preview-ascii").innerText();
  // 60 chars wide × 24 rows for floors 1–9 (default floor=1).
  const lines = ascii.split("\n");
  // innerText may strip the trailing newline, so trailing-empty-line count may vary.
  expect(lines.length).toBeGreaterThanOrEqual(24);
  expect(lines[0]!.length).toBe(60);
});

test("floor preview is deterministic — same seed/floor → identical ASCII", async ({
  page,
}) => {
  await page.goto("/#seed=phase2-e2e&floor=3");
  await page.waitForFunction(
    () => window.__FLOOR_PREVIEW__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const a = await page.evaluate(() => window.__FLOOR_PREVIEW_ASCII__);
  // Click "Generate floor" again with same args → same output.
  await page.locator("#preview-generate").click();
  const b = await page.evaluate(() => window.__FLOOR_PREVIEW_ASCII__);
  expect(a).toBe(b);
});

test("scripted-playthrough section runs and reports the SIM_DIGEST", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#sim-scripted")).toBeVisible();
  // The harness runs once on initial render so the flag should be set
  // before the click; assert via the window flag.
  await page.waitForFunction(
    () => typeof window.__SIM_FINAL_STATE_HASH__ === "string",
    null,
    { timeout: 10_000 },
  );
  const hash = await page.evaluate(() => window.__SIM_FINAL_STATE_HASH__);
  expect(hash).toBe(SIM_DIGEST);
});

test("scripted-playthrough button is idempotent — re-clicking produces same hash", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__SIM_FINAL_STATE_HASH__ === "string",
    null,
    { timeout: 10_000 },
  );
  const a = await page.evaluate(() => window.__SIM_FINAL_STATE_HASH__);
  await page.locator("#scripted-run").click();
  const b = await page.evaluate(() => window.__SIM_FINAL_STATE_HASH__);
  expect(a).toBe(b);
  expect(a).toBe(SIM_DIGEST);
  const outcome = await page.evaluate(() => window.__SIM_OUTCOME__);
  expect(outcome).toBe("running");
});

// Phase 4.A.2 atlas preview UI tests (memo decision 9 + addendum N12).

test("atlas preview UI is visible and ready", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#atlas-preview")).toBeVisible();
  await page.waitForFunction(
    () => window.__ATLAS_PREVIEW__ === "ready",
    null,
    { timeout: 10_000 },
  );
  await expect(page.locator("#atlas-seed-input")).toBeVisible();
  await expect(page.locator("#atlas-regenerate-button")).toBeVisible();
  await expect(page.locator("#atlas-preview-canvas")).toBeVisible();
});

test("atlas preview build hash equals live hash for the default seed (cross-runtime determinism)", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__ATLAS_PREVIEW__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const buildHash = await page.evaluate(
    () => window.__ATLAS_PREVIEW_BUILD_HASH__,
  );
  const liveHash = await page.evaluate(
    () => window.__ATLAS_PREVIEW_LIVE_HASH__,
  );
  expect(buildHash).toBe(ATLAS_DIGEST);
  expect(liveHash).toBe(ATLAS_DIGEST);
  expect(buildHash).toBe(liveHash);
});

for (const preset of PRESET_HASHES) {
  test(`atlas preset '${preset.id}' regenerates to its pinned expectedHash`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => window.__ATLAS_PREVIEW__ === "ready",
      null,
      { timeout: 10_000 },
    );
    // Click the preset button matching this preset.id.
    await page
      .locator(`.atlas-preset-button[data-preset-id="${preset.id}"]`)
      .click();
    // Wait for the live hash to update to the expected value.
    await page.waitForFunction(
      (expected) => window.__ATLAS_PREVIEW_LIVE_HASH__ === expected,
      preset.expectedHash,
      { timeout: 10_000 },
    );
    const seed = await page.evaluate(() => window.__ATLAS_PREVIEW_SEED__);
    expect(seed).toBe(preset.seed);
    const liveHash = await page.evaluate(
      () => window.__ATLAS_PREVIEW_LIVE_HASH__,
    );
    expect(liveHash).toBe(preset.expectedHash);
  });
}

// Phase 5.A.2 playable-game UI tests. The renderer + input + HUD are
// wired into `src/main.ts`'s startup path; the diagnostic surface is
// preserved beneath in a `<details id="diagnostics" open>` block so
// the existing 14 tests above keep passing without modification.

test("playable game section is visible and __GAME_READY__ === 'ready'", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__GAME_READY__ === "ready" || window.__GAME_READY__ === "error",
    null,
    { timeout: 10_000 },
  );
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator("#game-canvas")).toBeVisible();
  await expect(page.locator("#game-hud")).toBeVisible();
  const ready = await page.evaluate(() => window.__GAME_READY__);
  expect(ready).toBe("ready");
});

test("game HUD reflects the initial RunState (HP, floor, outcome)", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__GAME_READY__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const hp = await page.evaluate(() => window.__GAME_HP__);
  const floor = await page.evaluate(() => window.__GAME_FLOOR__);
  const outcome = await page.evaluate(() => window.__GAME_OUTCOME__);
  expect(hp).toBe(30); // PLAYER_INITIAL_HP_MAX
  expect(floor).toBe(1);
  expect(outcome).toBe("running");
  // Visible HUD elements.
  await expect(
    page.locator("[data-hud-field='hp']"),
  ).toContainText("30/30");
  await expect(
    page.locator("[data-hud-field='floor']"),
  ).toContainText("1");
});

test("five movement keys advance the sim state hash", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__GAME_READY__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const initialHash = await page.evaluate(() => window.__GAME_STATE_HASH__);
  expect(typeof initialHash).toBe("string");
  expect(initialHash!.length).toBe(64);

  // Synthesize five movement keypresses. We use ArrowDown so the
  // direction is well-defined regardless of where the entrance is on
  // floor 1; each press either succeeds (state hash advances) or is
  // blocked by a wall (state hash still advances because tick() is
  // still called and the state hash is `sha256(prev || encodeAction)`
  // — the hash advances on every player action regardless of whether
  // the player position changed).
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__GAME_STATE_HASH__);
  expect(after).not.toBe(initialHash);
  expect(after!.length).toBe(64);
});

test("diagnostic surface is preserved in a <details> wrapper", async ({
  page,
}) => {
  await page.goto("/");
  // The diagnostics section is a peer of #game and stays expanded by
  // default so the existing diagnostic e2e tests still find their
  // selectors.
  await expect(page.locator("#diagnostics")).toBeVisible();
  await expect(page.locator("#self-test-banner")).toBeVisible();
  await expect(page.locator("#floor-preview")).toBeVisible();
  await expect(page.locator("#sim-scripted")).toBeVisible();
  await expect(page.locator("#atlas-preview")).toBeVisible();
});

// ----------------------------------------------------------------------
// Phase 6.A.2 playable-game inventory + equipment UI tests.
// ----------------------------------------------------------------------

test("inventory + equipment panels render alongside the canvas", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__GAME_READY__ === "ready",
    null,
    { timeout: 10_000 },
  );
  await expect(page.locator("#inventory")).toBeVisible();
  await expect(page.locator("#equipment")).toBeVisible();
  // Initial state: empty inventory, empty equipment slots.
  await expect(page.locator("#inventory")).toContainText("0 stacks");
  await expect(
    page.locator("[data-equipment-value-for='weapon']"),
  ).toContainText("(empty)");
  await expect(
    page.locator("[data-equipment-value-for='cyberware']"),
  ).toContainText("(empty)");
});

test("pressing G triggers the pickup action (state hash advances)", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__GAME_READY__ === "ready",
    null,
    { timeout: 10_000 },
  );
  const initialHash = await page.evaluate(() => window.__GAME_STATE_HASH__);
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__GAME_STATE_HASH__);
  // Pickup with no item present is a state-side no-op, but the state
  // hash still advances because `tick` calls `advance(state, action)`
  // unconditionally for every player action.
  expect(after).not.toBe(initialHash);
});
