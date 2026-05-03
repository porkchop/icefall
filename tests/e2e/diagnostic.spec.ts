import { test, expect } from "@playwright/test";

const RANDOM_WALK_DIGEST =
  "142c5ee954cbcd40ea846f00c117bb59828bd61256729b2079c875d2c85dbac4";

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
