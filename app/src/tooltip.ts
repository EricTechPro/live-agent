// Tooltips for icon buttons (ticket 26). One floating tip for the whole window,
// shown on hover (after a short wait) and on keyboard focus, for any element with
// `data-tip` ("Pause") and optionally `data-key` ("Space"). The tip only repeats
// what the button's aria-label already says, so screen readers skip it.
// It lives outside every pixel frame (.pf clips its children), so it never gets cut.
// Also here: filling `[data-icon]` elements with their pixel icons.
import { iconSvg, type IconName } from "./icons.ts";
import { placeTip } from "./tip-position.ts";

/** Fill every `[data-icon]` element under `root` with its icon (sized by `data-size`, default 18). */
export function paintIcons(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon]")) setIcon(el, el.dataset.icon as IconName);
}

/** Swap an element's icon (e.g. Pause to Resume). */
export function setIcon(el: HTMLElement, name: IconName) {
  el.dataset.icon = name;
  el.innerHTML = iconSvg(name, Number(el.dataset.size ?? 18));
}

const SHOW_AFTER_MS = 350;

export function mountTooltips(root: HTMLElement = document.body) {
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("aria-hidden", "true");
  tip.hidden = true;
  root.append(tip);

  let anchor: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show(el: HTMLElement) {
    // A button whose menu is open (the mode pill) needs no tip over its menu.
    if (el.getAttribute("aria-haspopup") && el.getAttribute("aria-expanded") === "true") return;
    anchor = el;
    const label = el.dataset.tip ?? "";
    const key = el.dataset.key;
    tip.replaceChildren(label);
    if (key) tip.append(Object.assign(document.createElement("kbd"), { textContent: key }));
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const at = placeTip(r, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: innerWidth, height: innerHeight });
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    tip.dataset.side = at.side;
  }
  function hide() {
    clearTimeout(timer);
    anchor = undefined;
    tip.hidden = true;
  }
  const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? undefined;

  document.addEventListener("pointerover", (e) => {
    const el = target(e);
    if (el === anchor) return;
    hide();
    if (el) timer = setTimeout(() => show(el), SHOW_AFTER_MS);
  });
  document.addEventListener("pointerout", (e) => {
    if (target(e) && !target(e)!.contains(e.relatedTarget as Node | null)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = target(e);
    if (el?.matches(":focus-visible")) show(el);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && anchor) hide();
  });

  /** A button's tip changed (Pause to Resume): redraw it if it is showing. */
  return {
    refresh(el: HTMLElement) {
      if (anchor === el) show(el);
    },
  };
}
