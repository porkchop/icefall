import { runSelfTests, selfTestNames, randomWalkDigest } from "./core/self-test";
import { commitHash, rulesetVersion, atlasBinaryHash, atlasMissing } from "./build-info";
import { fingerprint } from "./core/fingerprint";
import { streamsForRun } from "./core/streams";
import { seedToBytes } from "./core/seed";
import { sha256Hex } from "./core/hash";
import { generateFloor, renderAscii } from "./mapgen/index";
import { runScripted, buildInitialRunState } from "./sim/harness";
import { applyFloorEntry, spawnFloorEntities } from "./sim/run";
import { tick } from "./sim/turn";
import {
  SELF_TEST_INPUTS,
  SELF_TEST_LOG_100,
} from "./sim/self-test-log";
import {
  SELF_TEST_WIN_INPUTS,
  SELF_TEST_WIN_LOG,
} from "./sim/self-test-win-log";
import { generateAtlas } from "./atlas/generate";
import { ATLAS_PRESET_SEEDS } from "./atlas/preset-seeds";
import { ATLAS_SEED_DEFAULT } from "./atlas/params";
import { validateSeedString } from "./atlas/seed";
import { loadAtlas, type LoadedAtlas } from "./atlas/loader";
import { drawScene, type RenderTarget, type AtlasImage } from "./render/canvas";
import { startKeyboard, DEFAULT_KEY_BINDINGS } from "./input/keyboard";
import { renderHud } from "./ui/hud";
import { renderInventory } from "./ui/inventory";
import { renderEquipment } from "./ui/equipment";
import { renderWinScreen } from "./ui/win-screen";
import { renderTitleScreen } from "./ui/title-screen";
import type { RunState } from "./sim/types";
import type { Action } from "./core/encode";
// Phase 8.A.2b — verifier + save layer + URL router (memo decision
// 10 + decision 8 + decision 6). The diagnostic page exposes
// "Verify a Pasted Log" + "Save Slots" + "Replay This Run" UI
// sections on top of these surfaces; the auto-redirect path is
// opt-in via `?run=` URL parameters and falls back gracefully when
// `releases/index.json` is unreachable (pre-8.A.3 deploy).
import { verify, type VerifyResult } from "./verifier/verify";
import { listSlots, type SaveSlot } from "./save/storage";
import {
  buildReleasesIndexUrl,
  decideRouting,
  type RoutingDecision,
} from "./router/redirect";
import { formatShareUrl } from "./router/url-parse";
import { decodeActionLog } from "./share/decode";
import { fingerprintFull } from "./core/fingerprint";
import type { FingerprintInputs } from "./core/fingerprint";

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
    // Phase 7.B — winning-replay cross-runtime determinism flags. The
    // diagnostic page runs `SELF_TEST_WIN_LOG` against
    // `SELF_TEST_WIN_INPUTS` once at page load, exposes the resulting
    // sha256-hex final state hash, and the cross-runtime Playwright
    // suite asserts equality with `WIN_DIGEST` on chromium / firefox /
    // webkit (mirrors the SIM_DIGEST → __SIM_FINAL_STATE_HASH__ pattern
    // from Phase 3).
    __SIM_WIN_FINAL_STATE_HASH__: string | undefined;
    __SIM_WIN_OUTCOME__: "running" | "dead" | "won" | undefined;
    __ATLAS_PREVIEW__: "ready" | undefined;
    __ATLAS_PREVIEW_BUILD_HASH__: string | undefined;
    __ATLAS_PREVIEW_LIVE_HASH__: string | undefined;
    __ATLAS_PREVIEW_SEED__: string | undefined;
    // Phase 5.A.2 — playable-game flags read by the cross-runtime
    // Playwright suite. `__GAME_READY__ === "ready"` after first paint.
    __GAME_READY__: "ready" | "error" | undefined;
    __GAME_ERROR__: string | undefined;
    __GAME_STATE_HASH__: string | undefined;
    __GAME_FLOOR__: number | undefined;
    __GAME_HP__: number | undefined;
    __GAME_OUTCOME__: "running" | "dead" | "won" | undefined;
    // Phase 8.A.2b — verifier + save + replay diagnostic flags. These
    // expose the page's verify/save/replay state to the cross-runtime
    // Playwright suite (memo decision 15). The replay viewer fires
    // when `?mode=replay` is in the URL.
    __VERIFY_RESULT_KIND__: VerifyResult["kind"] | "idle" | undefined;
    __SAVE_SLOTS_COUNT__: number | undefined;
    __ROUTER_DECISION_KIND__: RoutingDecision["kind"] | "skipped" | undefined;
    __REPLAY_MODE__: "active" | "idle" | undefined;
    __REPLAY_FINAL_STATE_HASH__: string | undefined;
    __REPLAY_OUTCOME__: "running" | "dead" | "won" | undefined;
    // Phase 8.A.3 — share-URL + auto-redirect + canonicalization flags
    // (memo addendum B9). Exposed for the cross-runtime Playwright suite
    // on the live deploy.
    __SHARE_URL__: string | undefined;
    __ROUTER_AUTO_DECISION_KIND__:
      | RoutingDecision["kind"]
      | "no-run-param"
      | "skipped"
      | undefined;
    __URL_CANONICALIZED__: "true" | "false" | undefined;
    // Phase 9.A.2 — title-screen activation flag. "active" when the
    // bare URL has no seed source anywhere (no `?seed=`, `?run=`,
    // or `#seed=`); "skipped" when any seed source is present so
    // the page boots straight into the playable game (preserves the
    // deep-link UX from Phase 5 and the share-URL flow from Phase 8).
    __TITLE_SCREEN__: "active" | "skipped" | undefined;
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

/* ------------------------------------------------------------------ */
/* Diagnostic surface (preserved from Phases 1.A → 4.A.2).            */
/*                                                                    */
/* This block builds the existing diagnostic page as a <details>      */
/* element with the `open` attribute set so the e2e suite (which      */
/* inspects DOM ids and `window.__*__` flags) keeps passing without   */
/* clicking anything. All previous DOM ids and window flags are       */
/* preserved verbatim per the Phase 5 frozen contract                 */
/* "Diagnostic surface preserved" rule.                               */
/* ------------------------------------------------------------------ */
function renderDiagnostic(host: HTMLElement): void {
  const details = document.createElement("details");
  details.id = "diagnostics";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Diagnostics (self-test, build info, floor preview, scripted playthrough, atlas preview)";
  details.appendChild(summary);

  const root = details;

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
    "Phase 5 diagnostic surface — preserved alongside the playable game UI " +
      "above so the cross-runtime determinism assertions from Phases 1.B → 4.B " +
      "keep passing. The placeholder ruleset has been retired in Phase 4.A.2; " +
      "the fingerprint shown here is a real (non-`DEV-`) value.",
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

  // Phase 3.A.2: scripted playthrough section.
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

  runSim();

  root.appendChild(simSection);

  // Phase 7.B: winning-replay section. Re-uses the same harness as the
  // Phase 3 scripted-playthrough section but on the Phase 7 winning
  // log. Cross-runtime: any drift in the talk/buy/sell handlers, the
  // shop-stock / shop-price roll domains, the boss FSM phase
  // transitions, or the boss-room spawn override surfaces here in any
  // runtime via the `WIN_DIGEST` golden.
  const winSection = el("section", "scripted-sim");
  winSection.id = "sim-win-replay";
  winSection.appendChild(el("h2", undefined, "Winning replay"));
  winSection.appendChild(
    el(
      "p",
      "scripted-help",
      "Phase 7 win loop: replay a synthesized 1217-action log that buys upgrades, descends to floor 10, and defeats the boss. The final state hash is pinned by WIN_DIGEST.",
    ),
  );

  const winButton = document.createElement("button");
  winButton.type = "button";
  winButton.id = "scripted-win-run";
  winButton.textContent = "Run winning replay";
  winSection.appendChild(winButton);

  const winOutput = el("dl", "scripted-output");
  winOutput.id = "scripted-win-output";
  winSection.appendChild(winOutput);

  function runWin(): void {
    const result = runScripted({
      inputs: SELF_TEST_WIN_INPUTS,
      actions: SELF_TEST_WIN_LOG,
    });
    const finalHash = sha256Hex(result.finalState.stateHash);
    window.__SIM_WIN_FINAL_STATE_HASH__ = finalHash;
    window.__SIM_WIN_OUTCOME__ = result.outcome;

    winOutput.innerHTML = "";
    function addRow(label: string, value: string): void {
      winOutput.appendChild(el("dt", undefined, label));
      winOutput.appendChild(el("dd", undefined, value));
    }
    addRow("final state hash", finalHash);
    addRow("outcome", result.outcome);
    addRow("floor reached", String(result.finalState.floorN));
    addRow("logLength", String(result.logLength));
  }

  winButton.addEventListener("click", () => {
    runWin();
  });

  runWin();

  root.appendChild(winSection);

  // Phase 4.A.2: atlas preview UI.
  const atlasSection = el("section", "atlas-preview");
  atlasSection.id = "atlas-preview";
  atlasSection.appendChild(el("h2", undefined, "Atlas preview"));
  atlasSection.appendChild(
    el(
      "p",
      "atlas-help",
      "Phase 4 atlas: build-time PNG (left) vs in-browser regenerated PNG (right). Identical bytes prove cross-runtime determinism.",
    ),
  );

  const atlasInputRow = el("div", "atlas-input-row");
  const atlasSeedLabel = el("label", "atlas-seed-label", "atlas seed");
  const atlasSeedInput = document.createElement("input");
  atlasSeedInput.type = "text";
  atlasSeedInput.id = "atlas-seed-input";
  atlasSeedInput.value = ATLAS_SEED_DEFAULT;
  atlasSeedLabel.appendChild(atlasSeedInput);
  atlasInputRow.appendChild(atlasSeedLabel);

  const atlasRegenButton = document.createElement("button");
  atlasRegenButton.type = "button";
  atlasRegenButton.id = "atlas-regenerate-button";
  atlasRegenButton.textContent = "Regenerate atlas";
  atlasInputRow.appendChild(atlasRegenButton);
  atlasSection.appendChild(atlasInputRow);

  const atlasPresets = el("div", "atlas-presets");
  for (const preset of ATLAS_PRESET_SEEDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atlas-preset-button";
    btn.dataset["presetId"] = preset.id;
    btn.textContent = preset.id;
    btn.addEventListener("click", () => {
      atlasSeedInput.value = preset.seed;
      regenerateLive();
    });
    atlasPresets.appendChild(btn);
  }
  atlasSection.appendChild(atlasPresets);

  const atlasErrorDiv = el("div", "atlas-preview-error");
  atlasErrorDiv.id = "atlas-preview-error";
  atlasSection.appendChild(atlasErrorDiv);

  const atlasCanvasRow = el("div", "atlas-canvas-row");
  const buildLabel = el("p", "atlas-canvas-label", "build-time");
  const liveLabel = el("p", "atlas-canvas-label", "live regen");
  const buildCanvas = document.createElement("canvas");
  buildCanvas.id = "atlas-preview-canvas-build";
  buildCanvas.className = "atlas-preview-canvas";
  const liveCanvas = document.createElement("canvas");
  liveCanvas.id = "atlas-preview-canvas";
  liveCanvas.className = "atlas-preview-canvas";
  atlasCanvasRow.appendChild(buildLabel);
  atlasCanvasRow.appendChild(buildCanvas);
  atlasCanvasRow.appendChild(liveLabel);
  atlasCanvasRow.appendChild(liveCanvas);
  atlasSection.appendChild(atlasCanvasRow);

  const atlasReadout = el("dl", "atlas-readout");
  atlasReadout.id = "atlas-readout";
  atlasSection.appendChild(atlasReadout);

  function setAtlasError(msg: string): void {
    atlasErrorDiv.textContent = msg;
  }

  function clearAtlasError(): void {
    atlasErrorDiv.textContent = "";
  }

  function drawPngToCanvas(
    png: Uint8Array,
    canvas: HTMLCanvasElement,
  ): Promise<void> {
    return new Promise((resolveDraw, rejectDraw) => {
      const blob = new Blob([png], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          URL.revokeObjectURL(url);
          rejectDraw(new Error("atlas-preview: 2d context unavailable"));
          return;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolveDraw();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        rejectDraw(new Error("atlas-preview: <img> decode failed"));
      };
      img.src = url;
    });
  }

  function refreshReadout(seed: string, buildHash: string, liveHash: string): void {
    atlasReadout.innerHTML = "";
    function row(label: string, value: string): void {
      atlasReadout.appendChild(el("dt", undefined, label));
      atlasReadout.appendChild(el("dd", undefined, value));
    }
    row("seed", seed);
    row("build hash", buildHash);
    row("live hash", liveHash);
    row("match", buildHash === liveHash ? "yes" : "no");
  }

  function regenerateLive(): void {
    const seed = atlasSeedInput.value;
    try {
      validateSeedString(seed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAtlasError(
        `atlas-preview: invalid atlas-seed (${msg})`,
      );
      return;
    }
    clearAtlasError();
    const { png } = generateAtlas(seed);
    const liveHash = sha256Hex(png);
    window.__ATLAS_PREVIEW_LIVE_HASH__ = liveHash;
    window.__ATLAS_PREVIEW_SEED__ = seed;
    refreshReadout(seed, atlasBinaryHash, liveHash);
    drawPngToCanvas(png, liveCanvas).catch((e) => {
      setAtlasError(`atlas-preview: live canvas draw failed: ${e.message}`);
    });
  }

  atlasRegenButton.addEventListener("click", () => {
    regenerateLive();
  });

  if (atlasMissing) {
    setAtlasError(
      "atlas-preview: assets/atlas.png is missing — run 'npm run gen-atlas' first",
    );
    window.__ATLAS_PREVIEW_BUILD_HASH__ = atlasBinaryHash;
    window.__ATLAS_PREVIEW__ = "ready";
  } else {
    fetch(import.meta.env.BASE_URL + "assets/atlas.png")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        const buildHash = sha256Hex(bytes);
        window.__ATLAS_PREVIEW_BUILD_HASH__ = buildHash;
        return drawPngToCanvas(bytes, buildCanvas);
      })
      .then(() => {
        regenerateLive();
        window.__ATLAS_PREVIEW__ = "ready";
      })
      .catch((e) => {
        setAtlasError(`atlas-preview: build atlas fetch failed: ${e.message}`);
        window.__ATLAS_PREVIEW_BUILD_HASH__ = atlasBinaryHash;
        regenerateLive();
        window.__ATLAS_PREVIEW__ = "ready";
      });
  }

  root.appendChild(atlasSection);

  // Phase 8.A.2b — Verify a Pasted Log section (memo decision 15).
  // Lets a user paste a base64url action-log wire string and a
  // claimed final state hash; runs verify() against the current
  // build's commit/ruleset/atlas. Exposes __VERIFY_RESULT_KIND__
  // for cross-runtime Playwright e2e.
  window.__VERIFY_RESULT_KIND__ = "idle";

  const verifySection = el("section", "verify-pasted");
  verifySection.id = "verify-pasted";
  verifySection.appendChild(el("h2", undefined, "Verify a pasted log"));
  verifySection.appendChild(
    el(
      "p",
      "verify-help",
      "Phase 8 verifier: paste a base64url action-log wire string + the claimed final state hash, and verify() will replay the log against the current build and report the discriminated VerifyResult kind.",
    ),
  );

  const verifyFormSeed = el("label", "verify-input-row", "seed");
  const verifySeedInput = document.createElement("input");
  verifySeedInput.type = "text";
  verifySeedInput.id = "verify-seed-input";
  verifySeedInput.placeholder = "alpha-1";
  verifyFormSeed.appendChild(verifySeedInput);
  verifySection.appendChild(verifyFormSeed);

  const verifyFormFp = el("label", "verify-input-row", "fingerprint (22-char or 43-char)");
  const verifyFpInput = document.createElement("input");
  verifyFpInput.type = "text";
  verifyFpInput.id = "verify-fp-input";
  verifyFpInput.placeholder = "iyFf_akWHbsMe8lprGyrH6";
  verifyFormFp.appendChild(verifyFpInput);
  verifySection.appendChild(verifyFormFp);

  const verifyFormHash = el("label", "verify-input-row", "claimed final state hash (64-hex)");
  const verifyHashInput = document.createElement("input");
  verifyHashInput.type = "text";
  verifyHashInput.id = "verify-hash-input";
  verifyHashInput.placeholder = "0".repeat(64);
  verifyFormHash.appendChild(verifyHashInput);
  verifySection.appendChild(verifyFormHash);

  const verifyFormLog = el("label", "verify-input-row", "action-log wire (base64url)");
  const verifyLogInput = document.createElement("textarea");
  verifyLogInput.id = "verify-log-input";
  verifyLogInput.rows = 4;
  verifyLogInput.placeholder = "(paste the #log= value from a shared URL)";
  verifyFormLog.appendChild(verifyLogInput);
  verifySection.appendChild(verifyFormLog);

  const verifyButton = document.createElement("button");
  verifyButton.type = "button";
  verifyButton.id = "verify-run";
  verifyButton.textContent = "Verify";
  verifySection.appendChild(verifyButton);

  const verifyOutput = el("pre", "verify-output");
  verifyOutput.id = "verify-output";
  verifySection.appendChild(verifyOutput);

  function runVerify(): void {
    const result = verify({
      fingerprint: verifyFpInput.value.trim(),
      seed: verifySeedInput.value,
      modIds: [],
      actionLog: verifyLogInput.value.trim(),
      claimedFinalStateHash: verifyHashInput.value.trim(),
      expectedAtlasBinaryHash: atlasBinaryHash,
    });
    verifyOutput.textContent = JSON.stringify(result, null, 2);
    window.__VERIFY_RESULT_KIND__ = result.kind;
  }
  verifyButton.addEventListener("click", () => {
    runVerify();
  });

  root.appendChild(verifySection);

  // Phase 8.A.3 — Share This Run section (memo decision 11 +
  // advisory A3 + addendum B9). Mints a shareable URL from the
  // user-supplied seed/mods; copies via navigator.clipboard.
  // Exposes window.__SHARE_URL__ for the cross-runtime e2e suite.
  const shareSection = el("section", "share-this-run");
  shareSection.id = "share-this-run";
  shareSection.appendChild(el("h2", undefined, "Share this run"));

  // Per advisory A3: the button text differs by deploy context.
  const baseUrl = import.meta.env.BASE_URL;
  const isPinnedRelease = /\/releases\/[0-9a-f]{12}\/$/.test(baseUrl);
  const shareLabel = isPinnedRelease
    ? `Mint share URL (pinned to commit ${baseUrl.slice(-13, -1)})`
    : "Mint share URL (pinned to current build)";
  shareSection.appendChild(
    el(
      "p",
      "share-help",
      `Phase 8 share: enter a seed (and optional mods, comma-separated), and the diagnostic page will compute the fingerprint under the current build's commitHash + rulesetVersion + mint a canonical share URL via formatShareUrl. The clipboard write is best-effort (some browsers gate clipboard on user gesture).`,
    ),
  );

  const shareSeedRow = el("label", "share-input-row", "seed");
  const shareSeedInput = document.createElement("input");
  shareSeedInput.type = "text";
  shareSeedInput.id = "share-seed-input";
  shareSeedInput.placeholder = "alpha-1";
  shareSeedRow.appendChild(shareSeedInput);
  shareSection.appendChild(shareSeedRow);

  const shareModsRow = el("label", "share-input-row", "mods (comma-separated, optional)");
  const shareModsInput = document.createElement("input");
  shareModsInput.type = "text";
  shareModsInput.id = "share-mods-input";
  shareModsInput.placeholder = "(empty)";
  shareModsRow.appendChild(shareModsInput);
  shareSection.appendChild(shareModsRow);

  const shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.id = "share-mint";
  shareButton.textContent = shareLabel;
  shareSection.appendChild(shareButton);

  const shareOutput = el("pre", "share-output");
  shareOutput.id = "share-output";
  shareSection.appendChild(shareOutput);

  function runShare(): void {
    const seed = shareSeedInput.value;
    const modIdsRaw = shareModsInput.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const inputs: FingerprintInputs = {
      commitHash,
      rulesetVersion,
      seed,
      modIds: modIdsRaw,
    };
    let fpFull: string;
    try {
      fpFull = fingerprintFull(inputs);
    } catch (e) {
      shareOutput.textContent = `error: ${(e as Error).message}`;
      return;
    }
    const fpShort = fpFull.slice(0, 22);
    const url = formatShareUrl(
      inputs,
      fpShort,
      null, // no #log= in 8.A.3 (Phase 9 polish adds the in-game log capture)
      window.location.origin + baseUrl,
    );
    shareOutput.textContent = url;
    window.__SHARE_URL__ = url;
    // Best-effort clipboard write. Per advisory A3, this requires
    // a user gesture in some browsers; the click handler IS the gesture
    // so navigator.clipboard.writeText should succeed in chromium /
    // firefox / webkit (released after 2022).
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      navigator.clipboard.writeText(url).catch(() => {
        // Silent fallback — the URL is still visible in the <pre>.
      });
    }
  }
  shareButton.addEventListener("click", () => {
    runShare();
  });

  root.appendChild(shareSection);

  // Phase 8.A.2b — Save Slots section (memo decision 15 + addendum
  // B6). Lists every `icefall:save:v1:*` localStorage key and surfaces
  // stale-release slots (different commitHash, same seed) with a
  // "Open in pinned release" link. Read-only — slot deletion is
  // Phase 9 polish.
  const saveSection = el("section", "save-slots");
  saveSection.id = "save-slots";
  saveSection.appendChild(el("h2", undefined, "Save slots"));
  saveSection.appendChild(
    el(
      "p",
      "save-help",
      "Phase 8 multi-slot save: every active run is keyed by its 22-char fingerprint short. Stale-release slots (same seed, different commitHash) are preserved and rendered with a redirect link.",
    ),
  );

  const saveList = el("ul", "save-list");
  saveList.id = "save-slots-list";
  saveSection.appendChild(saveList);

  function refreshSaveSlots(): void {
    saveList.innerHTML = "";
    let slots: readonly SaveSlot[] = [];
    try {
      slots = listSlots(window.localStorage);
    } catch {
      // localStorage may be unavailable (e.g. private browsing on
      // some browsers); render the empty state.
    }
    window.__SAVE_SLOTS_COUNT__ = slots.length;
    if (slots.length === 0) {
      const empty = el("li", "save-empty", "No active save slots.");
      saveList.appendChild(empty);
      return;
    }
    for (const slot of slots) {
      const isStale = slot.inputs.commitHash !== commitHash;
      const li = el("li", isStale ? "save-slot stale" : "save-slot");
      li.appendChild(
        el(
          "code",
          undefined,
          `${slot.fingerprintShort}  seed=${slot.inputs.seed}  floor=${slot.floorN}  hp=${slot.hpRemaining}  outcome=${slot.outcome}  saved=${slot.savedAt}`,
        ),
      );
      if (isStale) {
        const link = document.createElement("a");
        link.href = `${import.meta.env.BASE_URL}releases/${slot.inputs.commitHash}/?seed=${encodeURIComponent(slot.inputs.seed)}`;
        link.textContent = "[Open in pinned release]";
        link.className = "save-stale-link";
        li.appendChild(document.createTextNode(" "));
        li.appendChild(link);
      }
      saveList.appendChild(li);
    }
  }

  const saveRefreshButton = document.createElement("button");
  saveRefreshButton.type = "button";
  saveRefreshButton.id = "save-slots-refresh";
  saveRefreshButton.textContent = "Refresh";
  saveSection.appendChild(saveRefreshButton);
  saveRefreshButton.addEventListener("click", () => {
    refreshSaveSlots();
  });

  refreshSaveSlots();
  root.appendChild(saveSection);

  // Phase 8.A.2b — Replay This Run section (memo decision 9 +
  // decision 15). When `?mode=replay` is in the URL AND `?run=` +
  // `?seed=` are also present, decode the action log and replay it
  // via runScripted, exposing __REPLAY_FINAL_STATE_HASH__ and
  // __REPLAY_OUTCOME__ for cross-runtime e2e.
  window.__REPLAY_MODE__ = "idle";

  const replaySection = el("section", "replay-this-run");
  replaySection.id = "replay-this-run";
  replaySection.appendChild(el("h2", undefined, "Replay this run"));
  const replayUrl = new URL(window.location.href);
  const isReplayMode = replayUrl.searchParams.get("mode") === "replay";
  if (!isReplayMode) {
    replaySection.appendChild(
      el(
        "p",
        "replay-help",
        "Append `?mode=replay&run=<fp>&seed=<seed>#log=<wire>` to this URL to replay a shared run. The current page is not in replay mode.",
      ),
    );
  } else {
    window.__REPLAY_MODE__ = "active";
    const replayDecision = decideRouting(
      window.location.href,
      {
        commitHash,
        rulesetVersion,
        basePath: import.meta.env.BASE_URL,
      },
      null, // 8.A.2b skips the index fetch — that path is exercised by 8.A.3
    );
    window.__ROUTER_DECISION_KIND__ = replayDecision.kind;
    if (replayDecision.kind === "boot-replay" && replayDecision.logWire !== null) {
      try {
        const inputs: FingerprintInputs = replayDecision.inputs;
        const actions = decodeActionLog(replayDecision.logWire);
        const result = runScripted({ inputs, actions });
        const finalHash = sha256Hex(result.finalState.stateHash);
        window.__REPLAY_FINAL_STATE_HASH__ = finalHash;
        window.__REPLAY_OUTCOME__ = result.outcome;
        const dl = el("dl", "replay-output");
        dl.id = "replay-output";
        function row(k: string, v: string): void {
          dl.appendChild(el("dt", undefined, k));
          dl.appendChild(el("dd", undefined, v));
        }
        row("final state hash", finalHash);
        row("outcome", result.outcome);
        row("floor reached", String(result.finalState.floorN));
        row("logLength", String(result.logLength));
        replaySection.appendChild(dl);
      } catch (e) {
        const err = e as Error;
        replaySection.appendChild(
          el("pre", "replay-error", `replay failed: ${err.message}`),
        );
      }
    } else {
      replaySection.appendChild(
        el(
          "pre",
          "replay-error",
          `replay-mode URL did not parse as a boot-replay: ${replayDecision.kind}\n\n${
            replayDecision.kind === "error" ? replayDecision.message : ""
          }`,
        ),
      );
    }
  }
  root.appendChild(replaySection);

  host.appendChild(details);
}

/* ------------------------------------------------------------------ */
/* Playable game (Phase 5.A.2 — new).                                 */
/*                                                                    */
/* `startGame` is the single orchestrator wiring input → sim → render */
/* → ui per the Phase 5 frozen contract. The atlas is loaded once at  */
/* startup; the loader's PLACEHOLDER_RULESET_VERSION / ATLAS_MISSING / */
/* hash-mismatch refusal paths bubble exceptions to the top-level      */
/* error display.                                                     */
/* ------------------------------------------------------------------ */
async function startGame(host: HTMLElement): Promise<void> {
  const section = el("section", "game");
  section.id = "game";
  section.appendChild(el("h2", undefined, "ICEFALL"));
  section.appendChild(
    el(
      "p",
      "game-help",
      "Arrow keys / WASD: move (8 directions via Q/E/Z/C). Space or '.': wait. Shift+'.': descend stairs. G: grab item.",
    ),
  );

  const errorDiv = el("div", "game-error");
  errorDiv.id = "game-error";
  section.appendChild(errorDiv);

  const hudHost = el("div", "game-hud");
  hudHost.id = "game-hud";
  section.appendChild(hudHost);

  const canvas = document.createElement("canvas");
  canvas.id = "game-canvas";
  canvas.className = "game-canvas";
  // Make the canvas focusable so keystrokes are routed to it; the
  // window-level keyboard listener catches everything anyway, but this
  // gives a visible focus ring for accessibility-by-default.
  canvas.tabIndex = 0;
  section.appendChild(canvas);

  // Phase 6.A.2 — inventory + equipment panels.
  const inventoryHost = el("section", "game-inventory");
  inventoryHost.id = "inventory";
  section.appendChild(inventoryHost);

  const equipmentHost = el("section", "game-equipment");
  equipmentHost.id = "equipment";
  section.appendChild(equipmentHost);

  // Phase 7.A.2 — win-screen panel (hidden when outcome !== "won").
  const winScreenHost = el("section", "game-win-screen");
  winScreenHost.id = "win-screen";
  winScreenHost.style.display = "none";
  section.appendChild(winScreenHost);

  host.appendChild(section);

  // 1. Load the atlas. The loader refuses PLACEHOLDER_RULESET_VERSION
  //    and __ATLAS_MISSING__ builds with the pinned messages from
  //    `src/atlas/loader.ts` (Phase 4 addendum N7).
  let loaded: LoadedAtlas;
  try {
    loaded = await loadAtlas(import.meta.env.BASE_URL + "assets");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorDiv.textContent = msg;
    window.__GAME_READY__ = "error";
    window.__GAME_ERROR__ = msg;
    return;
  }

  // 2. Decode the PNG bytes into an HTMLImageElement that
  //    `ctx.drawImage` accepts. The browser's PNG decoder is the same
  //    surface as the atlas-preview UI; no Node-side path needed.
  let atlasImage: AtlasImage;
  try {
    atlasImage = await decodeAtlasImage(loaded.png);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorDiv.textContent = `game: atlas decode failed: ${msg}`;
    window.__GAME_READY__ = "error";
    window.__GAME_ERROR__ = msg;
    return;
  }

  // 3. Build the initial RunState from the URL seed.
  //    Phase 9.A.2: prefer `?seed=` (query string) over `#seed=`
  //    (legacy hash fragment from Phase 5). The Phase 9 title screen
  //    navigates via `?seed=<s>` (Phase 8 share-URL convention); the
  //    Phase 5 diagnostic floor-preview deep links use `#seed=&floor=`.
  //    Both paths are honored; query-string wins when both are set.
  const querySeedRaw = new URLSearchParams(window.location.search).get("seed");
  const hashState = readHashState();
  const seed =
    querySeedRaw !== null && querySeedRaw.length > 0
      ? querySeedRaw
      : hashState.seed;
  const inputs = {
    commitHash,
    rulesetVersion,
    seed,
    modIds: [] as readonly string[],
  };
  const streams = streamsForRun(seedToBytes(seed));
  let state: RunState = buildInitialRunState(inputs, streams);

  const target: RenderTarget = {
    canvas,
    atlas: loaded,
    atlasImage,
  };

  // 4. Render once before listening for input so the canvas is
  //    populated and the HUD reflects the initial state.
  function rerender(): void {
    drawScene(target, state);
    renderHud(hudHost, state);
    renderInventory(inventoryHost, state);
    renderEquipment(equipmentHost, state);
    // Phase 7.A.2 — show the win-screen only when outcome === "won".
    // The renderer is idempotent so re-rendering on every tick is
    // cheap; the host element's display is toggled by this branch.
    if (state.outcome === "won") {
      winScreenHost.style.display = "";
      renderWinScreen(winScreenHost, state);
    } else {
      winScreenHost.style.display = "none";
    }
    window.__GAME_STATE_HASH__ = sha256Hex(state.stateHash);
    window.__GAME_FLOOR__ = state.floorN;
    window.__GAME_HP__ = state.player.hp;
    window.__GAME_OUTCOME__ = state.outcome;
  }
  rerender();

  // 5. Wire keyboard → sim. On each Action, advance the sim, run the
  //    floor-entry block if `__pendingFloorEntry` is set (mirrors the
  //    harness loop), then re-render. On terminal outcome the
  //    keyboard handler short-circuits.
  function onAction(action: Action): void {
    if (state.outcome !== "running") return;

    if (state.__pendingFloorEntry) {
      const newFloor = generateFloor(state.floorN, streams);
      const newFloorState = spawnFloorEntities(state.floorN, newFloor, streams);
      state = applyFloorEntry(state, newFloorState);
    }

    state = tick(state, action);
    rerender();
  }
  startKeyboard(
    {
      bindings: DEFAULT_KEY_BINDINGS,
      target: window,
    },
    onAction,
  );

  window.__GAME_READY__ = "ready";
}

/**
 * Decode the atlas PNG bytes into an `HTMLImageElement` via a
 * Blob + ObjectURL round-trip. The same approach is used by the
 * atlas-preview's `drawPngToCanvas` (the canvas there uses the same
 * decoded image). Returns the loaded image, which `ctx.drawImage`
 * accepts via the `CanvasImageSource` union.
 */
function decodeAtlasImage(png: Uint8Array): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([png], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // Don't revoke the URL here — the image element's `src` keeps
      // the browser's blob alive, but revoking it on Webkit causes a
      // race where subsequent drawImage calls see an empty image. The
      // URL is short-lived (one per page load); leaking is harmless.
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decodeAtlasImage: <img> decode failed"));
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* Bootstrap.                                                         */
/* ------------------------------------------------------------------ */
/**
 * Phase 8.A.3 page-load routing entry point. Per
 * `artifacts/decision-memo-phase-8.md` decision 5 + addendum B5 + B9.
 *
 * Behavior on page load:
 *   1. If URL has no `?run=`, no routing happens (boot fresh).
 *   2. If URL has `?run=` matching the current build's fingerprint,
 *      run `history.replaceState` with the canonical share form
 *      (sorted mods, normalized encoding) so the URL bar matches
 *      the `formatShareUrl` output.
 *   3. If URL has `?run=` NOT matching the current build, fetch
 *      `releases/index.json` (with a 5s timeout + graceful fallback
 *      on 404), enumerate via `decideRouting`, and either:
 *        - Redirect via `window.location.replace(...)` to the
 *          matching `releases/<commit>/...`
 *        - Surface an error in the diagnostic page (via window flags)
 *
 * Returns `true` when a redirect is in flight (callers should NOT
 * proceed with rendering); `false` when the page should continue
 * to render normally.
 */
async function applyRouting(): Promise<boolean> {
  // Default flags for the cross-runtime e2e surface.
  window.__ROUTER_AUTO_DECISION_KIND__ = "skipped";
  window.__URL_CANONICALIZED__ = "false";

  const href = window.location.href;
  // Quick parse-and-classify without fetching the index. If there's
  // no `?run=`, exit early.
  const probeDecision = decideRouting(
    href,
    {
      commitHash,
      rulesetVersion,
      basePath: import.meta.env.BASE_URL,
    },
    null, // no index yet — see below for the fetch path
  );

  if (probeDecision.kind === "boot-fresh") {
    window.__ROUTER_AUTO_DECISION_KIND__ = "no-run-param";
    return false;
  }
  if (probeDecision.kind === "boot-replay") {
    // Fingerprint matches the current build. Canonicalize the URL
    // bar to the formatShareUrl output (sorted mods, normalized
    // encoding) for share-form consistency.
    //
    // Pass the FULL `href` (not `origin + pathname`) so any extra
    // query params the page recognizes — most importantly
    // `?mode=replay` which the diagnostic page's "Replay this run"
    // section reads later — are preserved through canonicalization.
    // formatShareUrl sets `?run=`, `?seed=`, `?mods=` on top of the
    // existing URL, leaving other params intact (per the WHATWG
    // `URLSearchParams.set` semantics).
    window.__ROUTER_AUTO_DECISION_KIND__ = "boot-replay";
    const canonical = formatShareUrl(
      probeDecision.inputs,
      probeDecision.claimedFingerprint,
      probeDecision.logWire,
      href,
    );
    if (canonical !== href) {
      try {
        window.history.replaceState(null, "", canonical);
        window.__URL_CANONICALIZED__ = "true";
      } catch {
        // History API may be locked down (sandboxed iframe etc.) —
        // ignore silently; the URL just won't canonicalize.
      }
    }
    return false;
  }
  if (probeDecision.kind === "error") {
    // URL parse / log decode error — surface in the diagnostic
    // page; don't try to redirect.
    window.__ROUTER_AUTO_DECISION_KIND__ = "error";
    return false;
  }
  // probeDecision.kind === "redirect" or "error" with index needed.
  // The probe didn't have the index yet; fetch and re-decide.

  let indexJson: string | null = null;
  try {
    const indexUrl = buildReleasesIndexUrl(
      window.location.origin,
      import.meta.env.BASE_URL,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(indexUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      indexJson = await res.text();
    }
  } catch {
    // Fetch failed (404, timeout, network error). Fall through to
    // null-index path.
  }

  const finalDecision = decideRouting(
    href,
    {
      commitHash,
      rulesetVersion,
      basePath: import.meta.env.BASE_URL,
    },
    indexJson,
  );
  window.__ROUTER_AUTO_DECISION_KIND__ = finalDecision.kind;

  if (finalDecision.kind === "redirect") {
    try {
      window.location.replace(finalDecision.target);
      return true;
    } catch {
      // window.location.replace may throw in sandboxed contexts;
      // fall through to render the diagnostic page so the user can
      // see the routing-error UI.
      return false;
    }
  }
  return false;
}

/**
 * Phase 9.A.2 — should the title screen render on this page load?
 *
 * The title screen renders on the BARE URL (no seed source anywhere).
 * Any of `?seed=`, `?run=`, or `#seed=` skips the title screen and
 * boots straight into the game — preserving Phase 5's deep-link UX
 * and Phase 8's share-URL flow.
 */
function shouldShowTitleScreen(): boolean {
  const search = new URLSearchParams(window.location.search);
  // Code-review S2 fix: an empty `?seed=` (no value) does NOT count
  // as a seed source — the downstream `startGame` consumer requires
  // length > 0. Skipping the title screen on `?seed=` empty would
  // boot the game with the hardcoded "diagnostic-sample" fallback,
  // surprising the user. Same rule for `?run=` (parseShareUrl
  // rejects an empty fp and the router surfaces ROUTE_ERR_FP_INVALID,
  // which is a worse UX than just showing the title screen).
  const seedQuery = search.get("seed");
  const runQuery = search.get("run");
  if ((seedQuery !== null && seedQuery.length > 0) ||
      (runQuery !== null && runQuery.length > 0)) {
    return false;
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (hash.length > 0) {
    const hashParams = new URLSearchParams(hash);
    const seedHash = hashParams.get("seed");
    if (seedHash !== null && seedHash.length > 0) return false;
  }
  return true;
}

/**
 * Phase 9.A.2 — today's date in YYYY-MM-DD form (UTC). Computed in
 * `main.ts` (which IS allowed to use `Date`) and passed into the
 * title screen as an option (the `src/ui/**` layer is banned from
 * `Date` per Phase 5 frozen contract).
 */
function todayUtcDate(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = "";

  // Phase 8.A.3 — apply routing first. If a redirect is in flight,
  // skip rendering (the page is about to navigate away).
  const redirecting = await applyRouting();
  if (redirecting) return;

  const header = el("header", "header");
  header.appendChild(el("h1", "title", "ICEFALL"));
  header.appendChild(
    el(
      "p",
      "subtitle",
      "Deterministic-shareable cyberpunk roguelike — phase 9 polish.",
    ),
  );
  root.appendChild(header);

  // Phase 9.A.2 — title-screen gate. On the bare URL (no seed source),
  // render the title screen INSTEAD of the game. The user picks a
  // seed and clicks "New Run", which navigates to `?seed=<s>` →
  // full page reload → bootstrap re-enters with a seed source →
  // skips title screen → boots into the game.
  if (shouldShowTitleScreen()) {
    window.__TITLE_SCREEN__ = "active";
    const titleSection = el("section", "title-screen-host");
    titleSection.id = "title-screen";
    root.appendChild(titleSection);

    renderTitleScreen(titleSection, {
      defaultSeed: todayUtcDate(),
      todayDate: todayUtcDate(),
      onNewRun: (seed) => {
        const target = new URL(window.location.href);
        target.search = "";
        target.searchParams.set("seed", seed);
        target.hash = "";
        window.location.assign(target.toString());
      },
      onRandomSeed: (dateSeed) => {
        const target = new URL(window.location.href);
        target.search = "";
        target.searchParams.set("seed", dateSeed);
        target.hash = "";
        window.location.assign(target.toString());
      },
      onPasteFingerprint: (pasted) => {
        // If the pasted text looks like a URL with an http(s) scheme,
        // navigate to it directly — `applyRouting` on the next page
        // load handles the parse + redirect. Schemes other than http
        // and https are REJECTED to prevent self-XSS via `javascript:`
        // or `data:` URIs (code-review S1 fix). Otherwise, treat as a
        // raw fingerprint and navigate to `?run=<fp>` with no seed;
        // the routing path surfaces ROUTE_ERR_SEED_MISSING which the
        // user can resolve by editing the URL.
        let parsedAsUrl: URL | null = null;
        try {
          const u = new URL(pasted);
          if (u.protocol === "http:" || u.protocol === "https:") {
            parsedAsUrl = u;
          }
        } catch {
          // Not a URL — fall through to the raw-fingerprint path below.
        }
        if (parsedAsUrl !== null) {
          window.location.assign(parsedAsUrl.toString());
          return;
        }
        const target = new URL(window.location.href);
        target.search = "";
        target.searchParams.set("run", pasted);
        target.hash = "";
        window.location.assign(target.toString());
      },
    });

    // The diagnostic page still renders below the title screen so
    // power users can verify pasted logs / inspect saves without
    // having to start a run first.
    renderDiagnostic(root);
    return;
  }

  window.__TITLE_SCREEN__ = "skipped";

  // Render the playable game first so the canvas is the visual
  // priority. The diagnostic surface follows below.
  await startGame(root);

  // Diagnostic surface (preserved from Phases 1.A → 4.A.2).
  renderDiagnostic(root);
}

bootstrap();
