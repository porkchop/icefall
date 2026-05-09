/**
 * Phase 9.A.2 title-screen UI — `renderTitleScreen(host, options)`.
 *
 * Per the Phase 5 frozen contract (`docs/ARCHITECTURE.md` "Phase 5
 * frozen contracts (renderer + input + ui)"):
 *
 *   - Read-only sink on inputs — no mutation of any imported state,
 *     no PRNG consumption, no Math.random.
 *   - Idempotent rendering: subsequent calls reuse the existing DOM
 *     skeleton; field text is updated in place. Build-only on first
 *     call; the title screen is typically rendered once per page load.
 *
 * Activation rule (Phase 9.A.1 → 9.A.2 acceptance criterion 1 per
 * `docs/PHASES.md:589`): the title screen renders BEFORE the
 * playable game when the URL has no `?seed=` AND no `?run=` AND
 * no `#seed=` (no seed source anywhere). The "New Run" button
 * navigates to `?seed=<chosen-seed>` (Phase 8 query-string
 * convention), triggering a full page reload that boots into the
 * game with the chosen seed via the existing `applyRouting` path.
 *
 * Buttons (per memo decision 11 + Phase 9.A.1 daily-seed convention):
 *   - "New Run" — uses the seed input value
 *   - "Random Seed (today's date)" — uses today's date in YYYY-MM-DD
 *   - "Paste Fingerprint" — opens a textarea that accepts a full
 *     `?run=&seed=` URL or a 22-char fingerprint; navigates to the
 *     pasted URL or constructs a `?run=<fp>&seed=<s>` URL from the
 *     fingerprint + a default seed prompt
 *
 * Keyboard contract (Phase 9.A.1 accessibility):
 *   - Tab cycles through the seed input + 3 buttons
 *   - Enter on the seed input activates "New Run"
 *   - Enter on a button activates the button
 *   - The :focus-visible CSS rule from 9.A.1 provides a high-contrast
 *     focus ring
 */

export type TitleScreenOptions = {
  /** Default seed pre-filled in the input (e.g., today's date). */
  readonly defaultSeed: string;
  /**
   * Today's date in YYYY-MM-DD form (UTC). Computed by the caller
   * (`src/main.ts`) and passed in — the `src/ui/**` layer is banned
   * from using `Date` per the Phase 5 frozen contract. The title
   * screen surfaces this in the "Random Seed (today: <date>)"
   * button label.
   */
  readonly todayDate: string;
  /**
   * Called when the user clicks "New Run" or presses Enter on the
   * seed input. Receives the trimmed seed; the caller is responsible
   * for navigation (the title-screen module is pure: no
   * `window.location.assign` calls).
   */
  readonly onNewRun: (seed: string) => void;
  /**
   * Called when the user clicks "Random Seed (today's date)".
   * Receives the date string in YYYY-MM-DD form (the same value
   * passed in `todayDate`).
   */
  readonly onRandomSeed: (dateSeed: string) => void;
  /**
   * Called when the user submits a pasted fingerprint or full URL.
   * Receives the pasted text (the caller decides whether to call
   * `parseShareUrl(href)` directly or treat the value as a bare
   * fingerprint + default seed).
   */
  readonly onPasteFingerprint: (pasted: string) => void;
};

const TITLE_SCREEN_CLASS = "title-screen";
const SEED_INPUT_FIELD = "seed-input";
const NEW_RUN_BUTTON_FIELD = "new-run-button";
const RANDOM_SEED_BUTTON_FIELD = "random-seed-button";
const PASTE_FP_BUTTON_FIELD = "paste-fp-button";
const PASTE_FP_INPUT_FIELD = "paste-fp-input";

/**
 * Idempotently render the title-screen section into `host`. Builds the
 * skeleton on first call; on subsequent calls only the seed input's
 * `value` attribute and the date-derived random-seed button label
 * update in place.
 */
export function renderTitleScreen(
  host: HTMLElement,
  options: TitleScreenOptions,
): void {
  let seedInput = host.querySelector<HTMLInputElement>(
    `[data-ui-field='${SEED_INPUT_FIELD}']`,
  );
  let newRunButton = host.querySelector<HTMLButtonElement>(
    `[data-ui-field='${NEW_RUN_BUTTON_FIELD}']`,
  );
  let randomSeedButton = host.querySelector<HTMLButtonElement>(
    `[data-ui-field='${RANDOM_SEED_BUTTON_FIELD}']`,
  );
  let pasteFpButton = host.querySelector<HTMLButtonElement>(
    `[data-ui-field='${PASTE_FP_BUTTON_FIELD}']`,
  );
  let pasteFpInput = host.querySelector<HTMLTextAreaElement>(
    `[data-ui-field='${PASTE_FP_INPUT_FIELD}']`,
  );

  const randomSeedLabel = `Random Seed (today: ${options.todayDate})`;

  if (
    seedInput === null ||
    newRunButton === null ||
    randomSeedButton === null ||
    pasteFpButton === null ||
    pasteFpInput === null
  ) {
    host.innerHTML = "";
    host.classList.add(TITLE_SCREEN_CLASS);

    const heading = document.createElement("h2");
    heading.className = "title-screen-title";
    heading.textContent = "ICEFALL";
    host.appendChild(heading);

    const subtitle = document.createElement("p");
    subtitle.className = "title-screen-subtitle";
    subtitle.textContent =
      "Deterministic-shareable cyberpunk roguelike. Pick a seed and start descending the stack.";
    host.appendChild(subtitle);

    // Seed input row.
    const seedLabel = document.createElement("label");
    seedLabel.className = "title-screen-input-row";
    seedLabel.textContent = "Seed";
    seedInput = document.createElement("input");
    seedInput.type = "text";
    seedInput.id = "title-seed-input";
    seedInput.className = "title-screen-input";
    seedInput.dataset["uiField"] = SEED_INPUT_FIELD;
    seedInput.value = options.defaultSeed;
    seedInput.placeholder = "alpha-1";
    seedInput.autocomplete = "off";
    seedInput.spellcheck = false;
    seedLabel.appendChild(seedInput);
    host.appendChild(seedLabel);

    // Button row.
    const buttonRow = document.createElement("div");
    buttonRow.className = "title-screen-button-row";

    newRunButton = document.createElement("button");
    newRunButton.type = "button";
    newRunButton.id = "title-new-run";
    newRunButton.className = "title-screen-button title-screen-button-primary";
    newRunButton.dataset["uiField"] = NEW_RUN_BUTTON_FIELD;
    newRunButton.textContent = "New Run";
    buttonRow.appendChild(newRunButton);

    randomSeedButton = document.createElement("button");
    randomSeedButton.type = "button";
    randomSeedButton.id = "title-random-seed";
    randomSeedButton.className = "title-screen-button";
    randomSeedButton.dataset["uiField"] = RANDOM_SEED_BUTTON_FIELD;
    randomSeedButton.textContent = randomSeedLabel;
    buttonRow.appendChild(randomSeedButton);

    pasteFpButton = document.createElement("button");
    pasteFpButton.type = "button";
    pasteFpButton.id = "title-paste-fp";
    pasteFpButton.className = "title-screen-button";
    pasteFpButton.dataset["uiField"] = PASTE_FP_BUTTON_FIELD;
    pasteFpButton.textContent = "Paste Fingerprint";
    buttonRow.appendChild(pasteFpButton);

    host.appendChild(buttonRow);

    // Hidden paste-fp textarea + submit row, revealed by the
    // "Paste Fingerprint" button. Pre-creating the DOM keeps the
    // idempotent-render contract simple.
    const pasteRow = document.createElement("div");
    pasteRow.className = "title-screen-paste-row";
    pasteRow.id = "title-paste-row";
    pasteRow.style.display = "none";

    const pasteLabel = document.createElement("label");
    pasteLabel.className = "title-screen-input-row";
    pasteLabel.textContent = "Paste a fingerprint URL or 22-char fingerprint";
    pasteFpInput = document.createElement("textarea");
    pasteFpInput.id = "title-paste-fp-input";
    pasteFpInput.className = "title-screen-paste-input";
    pasteFpInput.dataset["uiField"] = PASTE_FP_INPUT_FIELD;
    pasteFpInput.rows = 3;
    pasteFpInput.placeholder =
      "https://porkchop.github.io/icefall/?run=...&seed=...";
    pasteFpInput.spellcheck = false;
    pasteLabel.appendChild(pasteFpInput);
    pasteRow.appendChild(pasteLabel);

    const pasteSubmit = document.createElement("button");
    pasteSubmit.type = "button";
    pasteSubmit.id = "title-paste-submit";
    pasteSubmit.className = "title-screen-button";
    pasteSubmit.textContent = "Open pasted run";
    pasteRow.appendChild(pasteSubmit);

    host.appendChild(pasteRow);

    // Footer help text.
    const footer = document.createElement("p");
    footer.className = "title-screen-footer";
    footer.textContent =
      "Tab to navigate · Enter to activate · The same seed always produces the same dungeon";
    host.appendChild(footer);

    // Wire button handlers (one-time, on first render).
    function activateNewRun(): void {
      if (seedInput === null) return;
      const seed = seedInput.value.trim();
      if (seed.length === 0) return; // empty seed is ignored
      options.onNewRun(seed);
    }

    newRunButton.addEventListener("click", activateNewRun);

    seedInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        activateNewRun();
      }
    });

    randomSeedButton.addEventListener("click", () => {
      const dateSeed = options.todayDate;
      if (seedInput !== null) seedInput.value = dateSeed;
      options.onRandomSeed(dateSeed);
    });

    pasteFpButton.addEventListener("click", () => {
      pasteRow.style.display = pasteRow.style.display === "none" ? "block" : "none";
      if (pasteRow.style.display !== "none" && pasteFpInput !== null) {
        pasteFpInput.focus();
      }
    });

    pasteSubmit.addEventListener("click", () => {
      if (pasteFpInput === null) return;
      const pasted = pasteFpInput.value.trim();
      if (pasted.length === 0) return;
      options.onPasteFingerprint(pasted);
    });
  } else {
    // Idempotent re-render path: only the date-derived button label
    // can change between calls (across midnight UTC). The seed-input
    // value is preserved (the user may have typed something).
    randomSeedButton.textContent = randomSeedLabel;
  }
}
