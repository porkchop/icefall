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
import type { RunState } from "./sim/types";
import type { Action } from "./core/encode";

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

  // 3. Build the initial RunState from the URL-hash seed (or the
  //    default). The hash-state already exists on the diagnostic page;
  //    the playable game shares it so a deep link works for both.
  const hashState = readHashState();
  const inputs = {
    commitHash,
    rulesetVersion,
    seed: hashState.seed,
    modIds: [] as readonly string[],
  };
  const streams = streamsForRun(seedToBytes(hashState.seed));
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
async function bootstrap(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = "";

  const header = el("header", "header");
  header.appendChild(el("h1", "title", "ICEFALL"));
  header.appendChild(
    el(
      "p",
      "subtitle",
      "Phase 5: deterministic core engine + playable game UI.",
    ),
  );
  root.appendChild(header);

  // Render the playable game first so the canvas is the visual
  // priority. The diagnostic surface follows below.
  await startGame(root);

  // Diagnostic surface (preserved from Phases 1.A → 4.A.2).
  renderDiagnostic(root);
}

bootstrap();
