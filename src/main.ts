import { runSelfTests, selfTestNames, randomWalkDigest } from "./core/self-test";
import { commitHash, rulesetVersion } from "./build-info";
import { fingerprint } from "./core/fingerprint";

declare global {
  interface Window {
    __SELF_TEST_RESULT__: "green" | "red" | undefined;
    __SELF_TEST_DETAILS__: ReturnType<typeof runSelfTests> | undefined;
    __RANDOM_WALK_DIGEST__: string | undefined;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function render(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = "";

  const header = el("header", "header");
  header.appendChild(el("h1", "title", "ICEFALL — diagnostic"));
  header.appendChild(
    el(
      "p",
      "subtitle",
      "Phase 1: deterministic core engine + public deploy pipeline.",
    ),
  );
  root.appendChild(header);

  const result = runSelfTests();
  window.__SELF_TEST_DETAILS__ = result;

  const banner = el(
    "div",
    `banner ${result.ok ? "banner-ok" : "banner-fail"}`,
    result.ok
      ? `self-test passed — ${result.passed}/${result.total}`
      : `self-test FAILED — ${result.passed}/${result.total}`,
  );
  banner.dataset["status"] = result.ok ? "green" : "red";
  banner.id = "self-test-banner";
  root.appendChild(banner);

  const list = el("ul", "checks");
  const names = selfTestNames();
  const failureSet = new Set(
    result.failures.map((f) => f.split(":")[0]?.trim() ?? ""),
  );
  for (const name of names) {
    const failed = failureSet.has(name);
    const li = el("li", `check ${failed ? "check-fail" : "check-ok"}`);
    li.appendChild(el("span", "check-marker", failed ? "✘" : "✓"));
    li.appendChild(el("span", "check-name", name));
    list.appendChild(li);
  }
  root.appendChild(list);

  if (result.failures.length > 0) {
    const detail = el("pre", "failure-detail", result.failures.join("\n"));
    root.appendChild(detail);
  }

  const meta = el("section", "build-meta");
  meta.appendChild(el("h2", undefined, "Build info"));

  const dl = el("dl");
  function addRow(label: string, value: string): void {
    dl.appendChild(el("dt", undefined, label));
    dl.appendChild(el("dd", undefined, value));
  }
  addRow("commitHash", commitHash);
  addRow("rulesetVersion", rulesetVersion);

  const sampleFp = fingerprint({
    commitHash,
    rulesetVersion,
    seed: "diagnostic-sample",
    modIds: [],
  });
  addRow("sample fingerprint", sampleFp);
  meta.appendChild(dl);

  const note = el(
    "p",
    "warn",
    "This is the Phase 1 diagnostic page. The placeholder ruleset means " +
      "any fingerprint shown here is tagged DEV- and is not shareable. " +
      "Phase 4 wires in the real ruleset.",
  );
  meta.appendChild(note);
  root.appendChild(meta);

  window.__SELF_TEST_RESULT__ = result.ok ? "green" : "red";
  window.__RANDOM_WALK_DIGEST__ = randomWalkDigest();
}

render();
