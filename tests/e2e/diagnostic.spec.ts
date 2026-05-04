import { test, expect } from "@playwright/test";

const RANDOM_WALK_DIGEST =
  "142c5ee954cbcd40ea846f00c117bb59828bd61256729b2079c875d2c85dbac4";

const SIM_DIGEST =
  "321c09e5f87e879aebdf58ccaaada5e85f8a114bf01f4e012039eced5dba079e";

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

test("diagnostic page renders build info including DEV- fingerprint", async ({
  page,
}) => {
  await page.goto("/");
  const banner = page.locator("#self-test-banner");
  await expect(banner).toBeVisible();
  await expect(page.getByText("commitHash")).toBeVisible();
  await expect(page.getByText("rulesetVersion")).toBeVisible();
  // Phase 1 placeholder ruleset → fingerprint must be DEV- prefixed.
  const fingerprintText = await page
    .locator(".build-meta dd")
    .nth(2)
    .innerText();
  expect(fingerprintText.startsWith("DEV-")).toBe(true);
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
