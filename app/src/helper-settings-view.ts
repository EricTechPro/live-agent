// The Agents view's Helpers section: the default helper and each helper on or off.
// Saves through the setup path (POST /setup/save, src/setup), and the core uses it at
// once: no reconnect, the chat goes on. What a click saves: helper-settings.ts.
import type { Config } from "../../src/config/index.ts";
import { getSetup, saveSetup, type CoreClient } from "./core-client.ts";
import { HELPER_CHOICES, helperChange, type HelperChange, type HelperId, type HelperKey } from "./helper-settings.ts";

export function mountHelperSettings(core: CoreClient, root: HTMLElement) {
  let config: Config | undefined;
  let saving = false;

  root.innerHTML = `
    <h2 class="side-title" id="helpers-title">Helpers</h2>
    <div class="helper-row">
      <label for="default-helper">Default</label>
      <span class="pf sel"><select id="default-helper" aria-describedby="helpers-note"></select></span>
    </div>
    <div class="helper-chips" role="group" aria-labelledby="helpers-title"></div>
    <p class="helper-note" id="helpers-note" role="status"></p>`;
  const select = root.querySelector<HTMLSelectElement>("select")!;
  const chips = root.querySelector<HTMLElement>(".helper-chips")!;
  const note = root.querySelector<HTMLElement>(".helper-note")!;
  select.innerHTML = HELPER_CHOICES.map((h) => `<option value="${h.id}">${h.label}</option>`).join("");
  chips.innerHTML = HELPER_CHOICES.map(
    (h) => `<button class="pf chip" type="button" role="switch" data-key="${h.key}">${h.label}</button>`,
  ).join("");

  function render() {
    root.hidden = !config;
    if (!config) return;
    select.value = config.defaultHelper;
    select.disabled = saving;
    for (const chip of chips.querySelectorAll<HTMLButtonElement>("button")) {
      const on = config.helpers[chip.dataset.key as HelperKey];
      chip.setAttribute("aria-checked", String(on));
      chip.disabled = saving;
    }
  }

  async function apply(change: HelperChange) {
    if (!config || saving) return;
    const answers = helperChange(config, change);
    if (!answers) {
      note.textContent = "Keep at least one helper on.";
      return render();
    }
    saving = true;
    note.textContent = "";
    render();
    try {
      config = (await saveSetup(core.info, answers)).config;
    } catch (err) {
      note.textContent = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      saving = false;
      render();
    }
  }

  select.onchange = () => void apply({ type: "default", id: select.value as HelperId });
  chips.onclick = (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-key]");
    if (chip) void apply({ type: "toggle", key: chip.dataset.key as HelperKey });
  };
  // The wizard (or another save) changed the config: show what is saved now.
  core.onEvent((event) => {
    if (event.type === "setup.saved") (config = event.config), render();
  });

  render();
  void getSetup(core.info)
    .then((status) => ((config = status.current), render()))
    .catch(() => {});
}
