import { runSelfTests, selfTestNames, randomWalkDigest } from "./core/self-test";
import { commitHash, rulesetVersion } from "./build-info";
import { fingerprint } from "./core/fingerprint";
import { streamsForRun } from "./core/streams";
import { seedToBytes } from "./core/seed";
import { sha256Hex } from "./core/hash";
import { generateFloor, renderAscii } from "./mapgen/index";
import { runScripted } from "./sim/harness";
import {
  SELF_TEST_INPUTS,
  SELF_TEST_LOG_100,
} from "./sim/self-test-log";

declare global {
  interface Window {
    __SELF_TEST_RESULT__: "green" | "red" | undefined;
    __SELF_TEST_DETAILS__: ReturnType<typeof runSelfTests> | undefined;
    __RANDOM_WALK_DIGEST__: string | undefined;
    __FLOOR_PREVIEW__: "ready" | undefined;
    __FLOOR_PREVIEW_ASCII__: string | undefined;
    __SIM_FINAL_STATE_HASH__: string | undefined;
    __SIM_OUTCOME__: "running" | "dead" | "won" | undefined;
    __SIM_FLOOR_REACHED__: number | undefined;
  }
}

// URL-hash routing: #seed=foo&floor=3
function readHashState(): { seed: string; floor: number } {
  const defaults = { seed: "diagnostic-sample", floor: 1 };
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (hash === "") return defaults;
  const params = new URLSearchParams(hash);
  const seed = params.get("seed") ?? defaults.seed;
  const floorRaw = params.get("floor");
  const parsed = floorRaw === null ? defaults.floor : Number.parseInt(floorRaw, 10);
  const floor = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : defaults.floor;
  return { seed, floor };
}

function writeHashState(seed: string, floor: number): void {
  const params = new URLSearchParams();
  params.set("seed", seed);
  params.set("floor", String(floor));
  const next = `#${params.toString()}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, "", next);
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

  // Phase 2.A: ASCII floor preview.
  const previewSection = el("section", "preview");
  previewSection.id = "floor-preview";
  previewSection.appendChild(el("h2", undefined, "Floor preview"));
  previewSection.appendChild(
    el(
      "p",
      "preview-help",
      "Phase 2 mapgen: enter a seed and a floor number; the deterministic ASCII rendering appears below.",
    ),
  );

  const initial = readHashState();

  const form = el("form", "preview-form");
  form.id = "floor-preview-form";
  const seedLabel = el("label", "preview-label", "seed");
  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.id = "preview-seed";
  seedInput.value = initial.seed;
  seedLabel.appendChild(seedInput);

  const floorLabel = el("label", "preview-label", "floor");
  const floorSelect = document.createElement("select");
  floorSelect.id = "preview-floor";
  for (let n = 1; n <= 10; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    if (n === initial.floor) opt.selected = true;
    floorSelect.appendChild(opt);
  }
  floorLabel.appendChild(floorSelect);

  const button = document.createElement("button");
  button.type = "submit";
  button.id = "preview-generate";
  button.textContent = "Generate floor";

  form.appendChild(seedLabel);
  form.appendChild(floorLabel);
  form.appendChild(button);
  previewSection.appendChild(form);

  const previewPre = document.createElement("pre");
  previewPre.id = "floor-preview-ascii";
  previewPre.className = "preview-ascii";
  previewSection.appendChild(previewPre);

  function regenerate(seed: string, floorN: number): void {
    const streams = streamsForRun(seedToBytes(seed));
    const f = generateFloor(floorN, streams);
    const ascii = renderAscii(f);
    previewPre.textContent = ascii;
    window.__FLOOR_PREVIEW_ASCII__ = ascii;
    writeHashState(seed, floorN);
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const s = seedInput.value;
    const fn = Number.parseInt(floorSelect.value, 10);
    regenerate(s, fn);
  });

  // Initial render: show the floor for the URL-hash state (or defaults).
  regenerate(initial.seed, initial.floor);
  window.__FLOOR_PREVIEW__ = "ready";

  root.appendChild(previewSection);

  // Phase 3.A.2: scripted playthrough section. Exercises the headless
  // sim harness against the same SELF_TEST_INPUTS / SELF_TEST_LOG_100
  // pinned by the SIM_DIGEST self-test. Cross-runtime Playwright reads
  // window.__SIM_FINAL_STATE_HASH__ + __SIM_OUTCOME__ to verify
  // browser-side determinism end-to-end.
  const simSection = el("section", "scripted-sim");
  simSection.id = "sim-scripted";
  simSection.appendChild(el("h2", undefined, "Scripted playthrough"));
  simSection.appendChild(
    el(
      "p",
      "scripted-help",
      "Phase 3 sim: run a fixed 100-action scripted playthrough against the self-test seed. The final state hash is pinned by SIM_DIGEST.",
    ),
  );

  const simButton = document.createElement("button");
  simButton.type = "button";
  simButton.id = "scripted-run";
  simButton.textContent = "Run scripted playthrough";
  simSection.appendChild(simButton);

  const simOutput = el("dl", "scripted-output");
  simOutput.id = "scripted-output";
  simSection.appendChild(simOutput);

  function runSim(): void {
    const result = runScripted({
      inputs: SELF_TEST_INPUTS,
      actions: SELF_TEST_LOG_100,
    });
    const finalHash = sha256Hex(result.finalState.stateHash);
    window.__SIM_FINAL_STATE_HASH__ = finalHash;
    window.__SIM_OUTCOME__ = result.outcome;
    window.__SIM_FLOOR_REACHED__ = result.finalState.floorN;

    simOutput.innerHTML = "";
    function addRow(label: string, value: string): void {
      simOutput.appendChild(el("dt", undefined, label));
      simOutput.appendChild(el("dd", undefined, value));
    }
    addRow("final state hash", finalHash);
    addRow("outcome", result.outcome);
    addRow("floor reached", String(result.finalState.floorN));
    addRow("logLength", String(result.logLength));
  }

  simButton.addEventListener("click", () => {
    runSim();
  });

  // Run once on initial render so the page is in its final state for
  // Playwright assertions without requiring a click.
  runSim();

  root.appendChild(simSection);
}

render();
