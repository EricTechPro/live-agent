// The Agents tab's "Draw key" setting (ticket 45): the keys held to talk and circle on screen.
// Click Change, hold the new keys, let go: it is checked (src/config/hotkey.ts: two modifiers
// or more, not quick type's ⌃⌥T or show / hide's ⌃⌥S), saved through the setup path, and handed
// to Rust's poll (set_draw_hotkey) at once.
import type { Config } from "../../src/config/index.ts";
import { DEFAULT_DRAW_HOTKEY, comboFrom, formatHotkey, hotkeyConflict, parseHotkey } from "../../src/config/hotkey.ts";
import { getSetup, inTauri, saveSetup, setDrawHotkey, type CoreClient } from "./core-client.ts";

/** `onChange`: the configured draw key, at start and after each save (the Shortcuts card shows it). */
export function mountHotkeySettings(core: CoreClient, root: HTMLElement, onChange?: (drawHotkey: string) => void) {
  let config: Config | undefined;
  let recording = false;
  let best = "";

  root.innerHTML = `
    <h2 class="side-title" id="hotkey-title">Draw key</h2>
    <div class="helper-row">
      <label for="draw-hotkey">Hold to talk and circle</label>
      <button class="pf chip hotkey-key" id="draw-hotkey" type="button" aria-describedby="hotkey-note"></button>
      <button class="pf chip" id="draw-hotkey-reset" type="button">Reset</button>
    </div>
    <p class="helper-note" id="hotkey-note" role="status"></p>`;
  const keyBtn = root.querySelector<HTMLButtonElement>("#draw-hotkey")!;
  const resetBtn = root.querySelector<HTMLButtonElement>("#draw-hotkey-reset")!;
  const note = root.querySelector<HTMLElement>("#hotkey-note")!;

  function render() {
    root.hidden = !config;
    if (!config) return;
    keyBtn.textContent = recording ? (best ? formatHotkey(best) : "Hold the keys…") : formatHotkey(config.drawHotkey);
    keyBtn.setAttribute("aria-pressed", String(recording));
    resetBtn.hidden = config.drawHotkey === DEFAULT_DRAW_HOTKEY;
  }

  function tellRust(combo: string) {
    onChange?.(combo);
    const h = parseHotkey(combo);
    if (h && inTauri()) void setDrawHotkey(h.mods, h.key).catch(() => {});
  }

  async function save(combo: string) {
    const clash = hotkeyConflict(combo);
    if (clash) {
      note.textContent = `Not saved: ${clash}.`;
      return render();
    }
    note.textContent = "";
    try {
      config = (await saveSetup(core.info, { drawHotkey: combo })).config;
      tellRust(config.drawHotkey);
    } catch (err) {
      note.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
    render();
  }

  // Recording: the most keys held at once wins; a letter or digit ends it at once.
  function stop(commit: boolean) {
    recording = false;
    const combo = best;
    best = "";
    render();
    if (commit && combo) void save(combo);
  }
  keyBtn.onclick = () => {
    recording = !recording;
    best = "";
    note.textContent = recording ? "Hold the new keys, then let go. Esc cancels." : "";
    render();
  };
  resetBtn.onclick = () => void save(DEFAULT_DRAW_HOTKEY);
  keyBtn.addEventListener("keydown", (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stop(false);
    const combo = comboFrom(e);
    if (combo.split("+").length >= best.split("+").filter(Boolean).length) best = combo;
    if (/^(Key[A-Z]|Digit[0-9])$/.test(e.code)) return stop(true);
    render();
  });
  keyBtn.addEventListener("keyup", (e) => {
    if (!recording) return;
    e.preventDefault();
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) stop(true);
  });
  keyBtn.addEventListener("blur", () => recording && stop(false));

  core.onEvent((event) => {
    if (event.type === "setup.saved") (config = event.config), tellRust(config.drawHotkey), render();
  });
  render();
  void getSetup(core.info)
    .then((status) => {
      config = status.current;
      tellRust(config.drawHotkey);
      render();
    })
    .catch(() => {});
}
