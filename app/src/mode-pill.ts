// The safety mode pill in the chat composer (ticket 27), like ChatGPT's composer
// picker: the mode in use as a small pill left of the input; click it (or arrow
// keys / Enter) for a menu of Ask me / Auto edits / Bypass. Shift+Tab still cycles.
// Renders only: the pill shows the mode only from the core's `mode.changed`
// (through bottom-bar.ts), so the pill, the menu and Shift+Tab never disagree.
import type { SafetyMode } from "../../src/core/safety.ts";
import { addBarEvent, emptyBar, isModeCycleKey, type Bar } from "./bottom-bar.ts";
import type { CoreClient } from "./core-client.ts";
import { closedMenu, menuKey, menuToggle, type ModeMenu } from "./mode-menu.ts";
import { iconSvg } from "./icons.ts";

export function mountModePill(core: CoreClient, pill: HTMLButtonElement, list: HTMLUListElement) {
  let bar: Bar = emptyBar;
  let modes: { id: SafetyMode; label: string }[] = [];
  let menu: ModeMenu = closedMenu;
  const current = () => Math.max(0, modes.findIndex((m) => m.id === bar.mode));

  const labelEl = Object.assign(document.createElement("span"), { className: "pill-label", textContent: "…" });
  const chevron = Object.assign(document.createElement("span"), { className: "pill-chev", innerHTML: iconSvg("chevron", 12) });
  pill.replaceChildren(labelEl, chevron);
  pill.setAttribute("aria-haspopup", "listbox");
  pill.setAttribute("aria-controls", list.id);
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Safety mode");
  list.tabIndex = -1;

  function render() {
    const mode = modes.find((m) => m.id === bar.mode);
    labelEl.textContent = mode?.label ?? "…";
    pill.disabled = !bar.mode;
    pill.dataset.mode = bar.mode ?? "";
    pill.setAttribute("aria-label", `Safety mode: ${mode?.label ?? "loading"}`);
    pill.dataset.tip = `Safety: ${mode?.label ?? "…"}`;
    pill.dataset.key = "Shift+Tab";
    pill.setAttribute("aria-expanded", String(menu.open));
    list.hidden = !menu.open;
    list.replaceChildren(
      ...modes.map((m, i) => {
        const li = document.createElement("li");
        li.id = `mode-opt-${m.id}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(m.id === bar.mode));
        li.dataset.mode = m.id;
        li.className = i === menu.active ? "active" : "";
        li.append(Object.assign(document.createElement("span"), { className: "led" + (m.id === bar.mode ? " on" : "") }), m.label);
        li.onpointerdown = (e) => e.preventDefault(); // keep focus in the menu until the pick
        li.onclick = () => pick(i);
        return li;
      }),
    );
    if (menu.open) list.setAttribute("aria-activedescendant", `mode-opt-${modes[menu.active]?.id}`);
    else list.removeAttribute("aria-activedescendant");
  }

  function setMenu(next: ModeMenu, focus = true) {
    const wasOpen = menu.open;
    menu = next;
    render();
    if (!focus) return;
    if (menu.open && !wasOpen) list.focus();
    if (!menu.open && wasOpen) pill.focus();
  }

  function pick(i: number) {
    const wanted = modes[i]?.id;
    setMenu({ open: false, active: i });
    if (wanted && wanted !== bar.mode) core.setMode(wanted).catch(() => {});
  }

  pill.onclick = () => setMenu(menuToggle(menu, current()));
  const onKey = (e: KeyboardEvent) => {
    if (isModeCycleKey(e)) return; // Shift+Tab: the window-wide cycle below
    const step = menuKey(menu, e.key, modes.length, current());
    if (!step.handled && step.menu === menu) return;
    if (step.handled) e.preventDefault(), e.stopPropagation();
    if (step.pick !== undefined) pick(step.pick);
    else setMenu(step.menu, step.handled);
  };
  pill.addEventListener("keydown", onKey);
  list.addEventListener("keydown", onKey);
  list.addEventListener("focusout", (e) => {
    if (menu.open && !list.contains(e.relatedTarget as Node | null) && e.relatedTarget !== pill) setMenu({ ...menu, open: false }, false);
  });

  core.onEvent((event) => {
    const next = addBarEvent(bar, event);
    if (next.mode !== bar.mode) (bar = next), render();
    else bar = next;
  });

  // First draw: the core says which modes exist (with labels) and which is on. A mode.changed that beat this reply wins.
  core.getMode().then(({ mode, modes: offered }) => {
    modes = offered;
    if (!bar.mode) bar = addBarEvent(bar, { type: "mode.changed", mode });
    render();
  }, () => {});

  // In-window shortcut, not a global one: only while this window has focus.
  window.addEventListener("keydown", (e) => {
    if (!isModeCycleKey(e)) return;
    e.preventDefault();
    core.setMode("cycle").catch(() => {});
  });

  render();
}
