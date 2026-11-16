// The Gemini Live model and Jett's voice, in two places that never disagree: the panel's
// Settings (radio chips) and the composer's chip ("3.8 Live · Upbeat", a small menu).
// Renders only: the core keeps both (GET/POST /model, /voice); the voice also follows the
// core's `voice.changed`, so a voice Jett switched itself (set_voice) shows here too.
import type { Choice, CoreClient } from "./core-client.ts";
import type { Lang } from "./lang.ts";
import { UI } from "./ui-words.ts";
import { iconSvg } from "./icons.ts";

export interface SettingsEls {
  models: HTMLElement;
  voices: HTMLElement;
  modelNote: HTMLElement;
  chip: HTMLButtonElement;
  chipLabel: HTMLElement;
  menu: HTMLElement;
}

export interface SettingsApi {
  /** The voices to offer (for /voice suggestions). */
  voices(): Choice[];
  /** /voice <name>: a label or Gemini name. Resolves false for one that is not ours. */
  setVoice(name: string): Promise<boolean>;
  /** Draw again (the UI language changed). */
  render(): void;
  /** Focus the model picker (after /model opened Settings). */
  focusModel(): void;
}

/** "Gemini 3.8 Live" -> "3.8 Live": the chip has little room. */
export const shortModel = (label: string) => label.replace(/^Gemini\s+/i, "");

export function mountSettings(core: CoreClient, els: SettingsEls, opts: { lang: () => Lang; error: (text: string) => void }): SettingsApi {
  let model = "";
  let models: Choice[] = [];
  let voice = "";
  let voices: Choice[] = [];
  /** Saved but waiting for the next new chat (mid-chat models do not switch). */
  let modelPending = false;
  let menuOpen = false;

  const label = (list: Choice[], id: string) => list.find((c) => c.id === id)?.label ?? id;

  function chips(host: HTMLElement, list: Choice[], current: string, pick: (id: string) => void) {
    host.replaceChildren(
      ...list.map((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "set-choice";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(c.id === current));
        b.tabIndex = c.id === current || (!current && c === list[0]) ? 0 : -1;
        b.dataset.id = c.id;
        b.append(
          Object.assign(document.createElement("span"), { className: "led" + (c.id === current ? " on" : "") }),
          Object.assign(document.createElement("span"), { className: "set-choice-label", textContent: c.label }),
          Object.assign(document.createElement("small"), { textContent: c.id }),
        );
        b.onclick = () => pick(c.id);
        return b;
      }),
    );
  }
  // Arrow keys move between the radio chips, as a radio group should.
  for (const host of [els.models, els.voices]) {
    host.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const all = [...host.querySelectorAll<HTMLButtonElement>(".set-choice")];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      e.preventDefault();
      const next = all[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
      next?.focus();
      next?.click();
    });
  }

  function menuItem(text: string, sub: string, on: boolean, pick: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "menu-pick";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = -1;
    b.append(
      Object.assign(document.createElement("span"), { className: "led" + (on ? " on" : "") }),
      Object.assign(document.createElement("span"), { className: "menu-pick-label", textContent: text }),
      Object.assign(document.createElement("small"), { textContent: sub }),
    );
    b.onpointerdown = (e) => e.preventDefault();
    b.onclick = () => {
      setMenu(false);
      pick();
    };
    return b;
  }

  function render() {
    const words = UI[opts.lang()];
    chips(els.models, models, model, (id) => void pickModel(id));
    chips(els.voices, voices, voice, (id) => void pickVoice(id));
    els.modelNote.textContent = modelPending ? words.modelNext : words.modelNote;
    els.modelNote.dataset.pending = String(modelPending);
    const text = model ? `${shortModel(label(models, model))} · ${label(voices, voice) || "…"}` : "…";
    els.chipLabel.textContent = text;
    els.chip.disabled = !model;
    els.chip.dataset.tip = `${words.model} · ${words.voice}`;
    els.chip.setAttribute("aria-label", `${words.model}: ${label(models, model)}. ${words.voice}: ${label(voices, voice)}`);
    if (!els.chip.querySelector(".pill-chev")) els.chip.append(Object.assign(document.createElement("span"), { className: "pill-chev", innerHTML: iconSvg("chevron", 12) }));
    els.menu.replaceChildren(
      Object.assign(document.createElement("p"), { className: "menu-head", textContent: words.model }),
      ...models.map((m) => menuItem(m.label, modelPending && m.id === model ? words.modelNext : m.id, m.id === model, () => void pickModel(m.id))),
      Object.assign(document.createElement("p"), { className: "menu-head", textContent: words.voice }),
      ...voices.map((v) => menuItem(v.label, v.id, v.id === voice, () => void pickVoice(v.id))),
    );
    els.menu.hidden = !menuOpen;
    els.chip.setAttribute("aria-expanded", String(menuOpen));
  }

  async function pickModel(id: string) {
    if (id === model && !modelPending) return;
    try {
      const r = await core.setModel(id);
      model = r.model;
      modelPending = !r.applied;
    } catch (err) {
      opts.error(`model: ${err instanceof Error ? err.message : String(err)}`);
    }
    render();
  }
  async function pickVoice(id: string) {
    if (id === voice) return;
    try {
      voice = (await core.setVoice(id)).voice;
    } catch (err) {
      opts.error(`voice: ${err instanceof Error ? err.message : String(err)}`);
    }
    render();
  }

  function setMenu(open: boolean, focus = true) {
    if (menuOpen === open) return;
    menuOpen = open;
    render();
    if (!focus) return;
    if (open) els.menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    else els.chip.focus();
  }
  els.chip.onclick = () => setMenu(!menuOpen);
  els.menu.addEventListener("keydown", (e) => {
    const all = [...els.menu.querySelectorAll<HTMLButtonElement>(".menu-pick")];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
    }
  });
  els.menu.addEventListener("focusout", (e) => {
    if (menuOpen && !els.menu.contains(e.relatedTarget as Node | null) && e.relatedTarget !== els.chip) setMenu(false, false);
  });

  core.onEvent((event) => {
    if (event.type === "voice.changed") (voice = event.voice), render();
    // The new chat's connection uses the saved model.
    if (event.type === "chat.started" && modelPending) (modelPending = false), render();
  });
  void Promise.all([core.getModel(), core.getVoice()]).then(
    ([m, v]) => {
      ({ model, models } = m);
      ({ voice, voices } = v);
      render();
    },
    () => {},
  );
  render();

  return {
    voices: () => voices,
    async setVoice(name) {
      const key = name.trim().toLowerCase();
      const found = voices.find((v) => v.id.toLowerCase() === key || v.label.toLowerCase() === key);
      if (!found) return false;
      await pickVoice(found.id);
      return true;
    },
    render,
    focusModel() {
      els.models.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    },
  };
}
