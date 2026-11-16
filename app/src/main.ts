// The overlay window (tickets 36, 37). It only renders: core events in, orb + captions +
// popover out. No agent logic here; the core decides everything (docs/spec.md, App shell).
//
// One full-screen transparent window. Clicks pass through it except over the elements
// marked `data-hit`: a timer asks Rust where the cursor is and turns click-through off
// while it is over one (overlay.ts `capture`).
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { mountBoardAndBar } from "./board-view.ts";
import { mountModePill } from "./mode-pill.ts";
import { mountApprovals } from "./approvals-view.ts";
import { mountBrainView } from "./brain-view.ts";
import { mountChatView } from "./chat-view.ts";
import {
  connectCore, getSetup, inTauri, onCoreDown, onCoreReady, onCoreRestarting, onNewChat, onOpenPanel, onQuickType, onShowShortcuts, onToggleMini, overlayPoll, quickTypeFocus, restartCore,
  revealLog, setClickThrough, setTrayShown, waitForCore, type CoreClient, type CoreInfo,
} from "./core-client.ts";
import { waveFor, QUIET } from "./orb-wave.ts";
import { isNewChatKey, SHORTCUTS, SHORTCUTS_TITLE } from "./shortcuts.ts";
import { addWork, cuesFor, noWork, type Work } from "./cues.ts";
import { mountSketch, type SketchApi } from "./sketch-view.ts";
import { followFrontWindow, frontWindow, frontWindowAvoid, onFrontWindowMoved } from "./front-window.ts";
import { mountTooltips, paintIcons, setIcon } from "./tooltip.ts";
import { nextPanel, startPanel, tabForKey, TABS, type Panel, type PanelAction, type Tab } from "./panel.ts";
import { nextLayer, startLayer, type Layer, type LayerAction } from "./layers.ts";
import { mountLedOrb, type Mood } from "./led-orb.ts";
import { nextOrb, orbStart, type Orb, type OrbInput } from "./orb-state.ts";
import { addToTranscript, emptyTranscript, type Transcript } from "./transcript.ts";
import { callButton, callView, retryHint, showCallButtons, showsWords, spaceAction, type CallLook, type CallPhase, type CallView } from "./call-state.ts";
import { addCaption, barLine, noCaptions, shownCaptions, type Captions } from "./captions.ts";
import { spokenLang, WORDS, type Lang } from "./lang.ts";
import { followMic } from "./mic-follow.ts";
import {
  capture, DOUBLE_MS, dragEnd, dragTo, followStep, isDoubleClick, pollHover, isDrag, keepOn, parseSaved, placeOrb, placePopover,
  pttCallIdle, pttIdle, pttPress, pttRelease, pttStep, type PttCall, type Point, type Ptt, type Rect,
} from "./overlay.ts";
import { UI, type UiKey } from "./ui-words.ts";
import { dockPill, hoverPill, migrateDot, morph, MORPH_MS, parsePill, PILL, pillActions, pillAt, pillBars, pillFlyout, placePill, type PillAction, type PillSpot } from "./pill.ts";
import { runWizard } from "./wizard.ts";
import { isQuickTypeStart, nextQuick, quickClosed, quickPlace, type Quick, type QuickAction } from "./quick-type.ts";
import { createScreenInk, type ScreenInk } from "./screen-ink.ts";
import { COMMANDS, moveActive, parseSlash, suggest, type Suggestion } from "./slash.ts";
import { mountSettings, type SettingsApi } from "./settings-view.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// Icon buttons (ticket 26): pixel icons from icons.ts, one shared tooltip.
paintIcons();
const tips = mountTooltips();
const overlay = $("overlay");
const dock = $("dock");
const orbEl = $<HTMLButtonElement>("orb");
const orbLabel = $("orb-label");
const retryBtn = $<HTMLButtonElement>("orb-retry");
const finishSetupBtn = $<HTMLButtonElement>("orb-setup");
const orbHint = $("orb-hint");
/** The one call button: Start call, or Hang up while a call is joining or live. */
const talkBtn = $<HTMLButtonElement>("talk");
const transcriptEl = $<HTMLOListElement>("transcript");
const typeForm = $<HTMLFormElement>("type");
const typeInput = $<HTMLInputElement>("type-input");
const setupBtn = $<HTMLButtonElement>("setup");
const sendBtn = $<HTMLButtonElement>("send");
const newChatBtn = $<HTMLButtonElement>("new-chat");
const popover = $("popover");
const approvalsEl = $("approvals");
const stage = $("stage");
/** The drawing on the screen (drawing v2), once the core is up. */
let sketch: SketchApi | undefined;
/** The model and voice pickers (Settings and the composer's chip), once the core is up. */
let settings: SettingsApi | undefined;
const wizardEl = $("wizard");
/** The UI language: the one you last spoke (lang.ts); every label and tooltip follows it. */
let lang: Lang = "en";

// ---- the orb's spot: drag the orb (or arrow keys on it); it stays where you leave it ----
const ORB_KEY = "jett.orb";
const view = () => ({ width: innerWidth, height: innerHeight });
const dockSize = () => ({ width: dock.offsetWidth, height: dock.offsetHeight });
let orbAt: Point = { x: 0, y: 0 };
function storedSpot() {
  try {
    return parseSaved(localStorage.getItem(ORB_KEY));
  } catch {
    return undefined;
  }
}
function moveOrb(at: Point, save = false) {
  orbAt = at;
  dock.style.left = `${at.x}px`;
  dock.style.top = `${at.y}px`;
  placeFloaters();
  placeQuick();
  if (save) {
    try {
      localStorage.setItem(ORB_KEY, JSON.stringify(at));
    } catch {
      // Storage can be off; the orb just starts in the corner next time.
    }
  }
}
// ---- minimised (tickets 38, 39): a slim pill docked flush to a side edge ----------
const MINI_KEY = "jett.mini";
/** Where you dragged the pill (only drags are saved, so an untouched pill follows the orb). */
const PILL_KEY = "jett.pill";
/** Ticket 38's dot spot: moved over to the pill once, then dropped. */
const DOT_KEY = "jett.dot";
const DOT = { width: 20, height: 20 };
const pillEl = $<HTMLButtonElement>("pill");
const pillActionsEl = $("pill-actions");
const pillCallBtn = $<HTMLButtonElement>("pill-call");
const pillHangupBtn = $<HTMLButtonElement>("pill-hangup");
let pillSpot: PillSpot = { side: "right", y: 0 };
let pillOpen = false;
let pillList: PillAction[] = ["expand"];
let mini = false;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const load = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage off: defaults
  }
};
const store = (key: string, value: string | undefined) => {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembered; works for this run.
  }
};
// A dot you dragged in ticket 38 becomes the pill's spot, once.
(function migrateOldDot() {
  const dot = parseSaved(load(DOT_KEY));
  if (!dot) return;
  if (!parsePill(load(PILL_KEY))) store(PILL_KEY, JSON.stringify(migrateDot(dot, DOT, view())));
  store(DOT_KEY, undefined);
})();
const pillRect = (): Rect => ({ ...pillAt(pillSpot, view()), ...PILL });
function movePill(spot: PillSpot, save = false) {
  pillSpot = spot;
  const at = pillAt(spot, view());
  pillEl.style.left = `${at.x}px`;
  pillEl.style.top = `${at.y}px`;
  pillEl.dataset.dock = spot.side;
  // Tooltips open away from the edge.
  for (const el of [pillEl, ...pillActionsEl.querySelectorAll<HTMLElement>("[data-tip]")]) {
    if (spot.side === "right") el.dataset.side = "left";
    else delete el.dataset.side;
  }
  if (pillOpen) placePillActions();
  placeQuick();
  if (save) store(PILL_KEY, JSON.stringify(spot));
}
function placePillActions() {
  const f = pillFlyout(pillRect(), pillSpot.side, pillList.length);
  pillActionsEl.style.left = `${f.x}px`;
  pillActionsEl.style.top = `${f.y}px`;
}
/** Hover from the poll's cursor (or the pointer in a browser preview) opens the quick actions. */
function updatePillHover(point: Point | undefined) {
  setPillOpen(mini && !drag && hoverPill(point, pillRect(), pillSpot.side, pillOpen, pillList.length));
}
function setPillOpen(open: boolean) {
  if (open === pillOpen) return;
  pillOpen = open;
  pillEl.classList.toggle("hover", open);
  pillActionsEl.hidden = !open;
  if (open) placePillActions();
  else tips.hide();
}
/** Orb <-> pill (ticket 39): the orb shrinks and slides onto the pill in about 200 ms. */
function animateMorph(toPill: boolean): Promise<void> {
  const ms = MORPH_MS(reducedMotion);
  if (!ms || typeof dock.animate !== "function") return Promise.resolve();
  const m = morph({ ...orbAt, ...dockSize() }, pillRect());
  const frames: Keyframe[] = [
    { transform: "none", opacity: 1, offset: 0 },
    { opacity: 0.85, offset: 0.6 },
    { transform: `translate(${m.x}px, ${m.y}px) scale(${m.sx}, ${m.sy})`, opacity: 0, offset: 1 },
  ];
  dock.style.transformOrigin = "0 0";
  const a = dock.animate(toPill ? frames : frames.reverse().map((k) => ({ ...k, offset: 1 - (k.offset as number) })), { duration: ms, easing: "cubic-bezier(.2,.8,.2,1)" });
  return a.finished.then(() => {}, () => {});
}
let miniSeq = 0;
/** Minimise to the pill (minus, double-click, Ctrl+Option+S, the menu bar) or bring Jett back. */
async function setMini(on: boolean, save = true, animate = true) {
  const seq = ++miniSeq;
  mini = on;
  if (save) store(MINI_KEY, on ? "1" : "0");
  void setTrayShown(!on).catch(() => {});
  if (on) {
    setLayer("close");
    showShortcuts(false);
    movePill(placePill(parsePill(load(PILL_KEY)), undefined, DOT, { ...orbAt, ...dockSize() }, view()));
    if (animate && overlay.dataset.mini !== "true") await animateMorph(true);
    if (seq !== miniSeq) return; // changed again mid-animation
    overlay.dataset.mini = "true";
    pillEl.hidden = false;
    tips.hide();
  } else {
    setPillOpen(false);
    pillEl.hidden = true;
    const was = overlay.dataset.mini === "true";
    overlay.dataset.mini = "false";
    moveOrb(keepOn(orbAt, dockSize(), view()));
    if (animate && was) void animateMorph(false);
  }
}

// ---- dragging (tickets 38, 39): press and move drags the orb or the pill; a press
// without movement is still a click (overlay.ts `isDrag`). ----
let drag: { what: "orb" | "pill"; el: HTMLElement; start: Point; from: Point; moved: boolean; startedAt: number; lastMoveAt: number; pointerId: number } | undefined;
/** A drag just ended on this press: the click that follows it is swallowed. */
let swallowClick = false;
function pressDrag(el: HTMLElement, what: "orb" | "pill", e: PointerEvent, now = false) {
  if (e.button !== 0) return;
  swallowClick = false;
  const t = performance.now();
  drag = { what, el, start: what === "pill" ? pillAt(pillSpot, view()) : orbAt, from: { x: e.clientX, y: e.clientY }, moved: now, startedAt: t, lastMoveAt: t, pointerId: e.pointerId };
  el.setPointerCapture(e.pointerId);
  if (now) (what === "pill" ? pillEl : dock).classList.add("dragging");
}
function moveDrag(e: PointerEvent) {
  if (!drag) return;
  // Ticket 40: no button held means the press is over, whatever WebKit missed.
  if (e.buttons === 0) return endDrag();
  drag.lastMoveAt = performance.now();
  const now = { x: e.clientX, y: e.clientY };
  if (!drag.moved) {
    if (!isDrag(drag.from, now)) return;
    drag.moved = true;
    (drag.what === "pill" ? pillEl : dock).classList.add("dragging");
    if (drag.what === "pill") setPillOpen(false);
  }
  if (drag.what === "orb") moveOrb(dragTo(drag.start, drag.from, now, dockSize(), view()));
  else {
    // Free while held; it re-docks to the nearer side edge when dropped.
    const x = Math.max(0, Math.min(innerWidth - PILL.width, drag.start.x + now.x - drag.from.x));
    const y = Math.max(0, Math.min(innerHeight - PILL.height, drag.start.y + now.y - drag.from.y));
    pillEl.style.left = `${x}px`;
    pillEl.style.top = `${y}px`;
    pillEl.dataset.dock = x + PILL.width / 2 < innerWidth / 2 ? "left" : "right";
  }
}
function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = undefined;
  try {
    if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
  } catch {
    // Already released.
  }
  dock.classList.remove("dragging");
  pillEl.classList.remove("dragging");
  if (!d.moved) return;
  swallowClick = true;
  if (d.what === "orb") moveOrb(orbAt, true);
  else movePill(dockPill({ x: pillEl.offsetLeft, y: pillEl.offsetTop }, view()), true);
}
for (const [el, what, now] of [[orbEl, "orb", false], [pillEl, "pill", false]] as const) {
  el.addEventListener("pointerdown", (e) => pressDrag(el, what, e, now));
  el.addEventListener("pointermove", moveDrag);
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  // Ticket 40: capture can go without a pointer up (focus moved, another app took the click).
  el.addEventListener("lostpointercapture", endDrag);
}
/** Ticket 40: end a drag on any sign the press is over (overlay.ts `dragEnd`). */
function checkDrag(signs: Omit<Parameters<typeof dragEnd>[1], "now">) {
  if (drag && dragEnd(drag, { now: performance.now(), ...signs })) endDrag();
}
window.addEventListener("blur", () => checkDrag({ blur: true }));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drag) {
    e.preventDefault();
    e.stopImmediatePropagation();
    checkDrag({ escape: true });
  }
}, true);
// No poll in a browser preview: a drag held still for a few seconds ends.
setInterval(() => checkDrag({}), 1000);
// The pill: a click (not a drag) brings the orb back where it was. Its quick actions:
// expand, the mic (start a call, or mute / unmute) and hang up.
pillEl.addEventListener("click", () => {
  if (swallowClick) return void (swallowClick = false);
  void setMini(false);
});
$<HTMLButtonElement>("pill-expand").onclick = () => void setMini(false);
pillCallBtn.onclick = () => primary();
pillHangupBtn.onclick = () => void endCall();
if (!inTauri()) window.addEventListener("pointermove", (e: PointerEvent) => updatePillHover({ x: e.clientX, y: e.clientY }));
dock.addEventListener("focusin", () => updateControls());
dock.addEventListener("focusout", () => setTimeout(updateControls));
// The orb moves by keyboard too: arrow keys, Shift for bigger steps.
orbEl.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 80 : 20;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  moveOrb(keepOn({ x: orbAt.x + d[0]!, y: orbAt.y + d[1]! }, dockSize(), view()), true);
});
addEventListener("resize", () => {
  moveOrb(keepOn(orbAt, dockSize(), view()));
  movePill(pillSpot);
});

/** The popover and approval cards sit beside the orb, on the side with room. */
function placeFloaters() {
  const orbRect = { ...orbAt, ...dockSize() };
  if (!popover.hidden) {
    const at = placePopover(orbRect, { width: popover.offsetWidth, height: popover.offsetHeight }, view());
    popover.style.left = `${at.x}px`;
    popover.style.top = `${at.y}px`;
  }
  if (!approvalsEl.hidden) {
    const at = placePopover(orbRect, { width: approvalsEl.offsetWidth, height: approvalsEl.offsetHeight }, view());
    approvalsEl.style.left = `${at.x}px`;
    // With the popover open on the same side, the cards sit just above the orb instead.
    approvalsEl.style.top = `${popover.hidden ? at.y : Math.max(16, orbAt.y - approvalsEl.offsetHeight - 10)}px`;
    if (!popover.hidden) approvalsEl.style.left = `${keepOn({ x: orbAt.x + orbRect.width / 2 - approvalsEl.offsetWidth / 2, y: 0 }, { width: approvalsEl.offsetWidth, height: 0 }, view()).x}px`;
  }
  // The cues hang beside the orb, on the side with room, level with the orb.
  const cuesEl = $("cues");
  const left = orbAt.x + orbRect.width / 2 > innerWidth / 2;
  cuesEl.dataset.side = left ? "left" : "right";
  cuesEl.style.left = `${left ? orbAt.x - 6 : orbAt.x + orbRect.width + 6}px`;
  cuesEl.style.top = `${orbAt.y + orbEl.offsetTop + orbEl.offsetHeight / 2}px`;
  // Drawing cards (drawing v2) lay themselves out on the screen, clear of the orb, its
  // cues and any open popover; they fill columns from the side away from the orb.
  const box = (el: HTMLElement) => {
    if (el.hidden || !el.offsetWidth) return undefined;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  // The front app's window too (the core reports it while a drawing is up: front-window.ts).
  const win = frontWindow();
  const front = frontWindowAvoid(win, view());
  const avoid = [{ x: orbRect.x, y: orbRect.y, w: orbRect.width, h: orbRect.height }, box(cuesEl), box(popover), box(approvalsEl), ...front.hard];
  sketch?.setObstacles(avoid.filter((r) => !!r), left ? "left" : "right", front.soft);
}
new MutationObserver(() => {
  // A question for you brings Jett back from the dot: approvals sit beside the orb.
  if (mini && !approvalsEl.hidden) void setMini(false);
  placeFloaters();
}).observe(approvalsEl, { attributes: true, attributeFilter: ["hidden"], childList: true });

// ---- click-through (ticket 36): take the mouse only over the interactive bits ----
function hitRects(): Rect[] {
  return [...document.querySelectorAll<HTMLElement>("[data-hit]")]
    .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed")
    .filter((el) => !el.hidden && !el.closest("[hidden]"))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })
    .filter((r) => r.width > 0 && r.height > 0);
}
// Follow my pointer (ticket 37): off unless chosen; the orb then trails the pointer.
const FOLLOW_KEY = "jett.follow";
const followBtn = $<HTMLButtonElement>("follow");
let following = false;
try {
  following = localStorage.getItem(FOLLOW_KEY) === "1";
} catch {
  // Storage off: stay where dragged.
}
const followingBtn = $<HTMLButtonElement>("following");
function showFollow() {
  // Ticket 40: following is never a mystery; a small badge on the orb says so and stops it.
  dock.dataset.following = String(following);
  followingBtn.hidden = !following;
  followingBtn.dataset.tip = UI[lang].stopFollowing;
  followingBtn.setAttribute("aria-label", UI[lang].stopFollowing);
  // Settings' switch (it was a header icon before the panel polish).
  followBtn.setAttribute("aria-checked", String(following));
  $("follow-text").textContent = UI[lang].follow;
}
function setFollowing(on: boolean) {
  following = on;
  showFollow();
  if (!following) moveOrb(orbAt, true);
  try {
    localStorage.setItem(FOLLOW_KEY, following ? "1" : "0");
  } catch {
    // Not remembered; works for this run.
  }
}
followBtn.onclick = () => setFollowing(!following);
followingBtn.onclick = () => setFollowing(false);
showFollow();

/**
 * One poll, about 20 times a second (Tauri only): click-through on or off for where the
 * cursor is, push to talk (hold Ctrl+Option), and following the pointer if chosen.
 */
let ptt: Ptt = pttIdle;
// Screen awareness (slice 2): ink while Ctrl+Option is held (app/src/screen-ink.ts).
let screenInk: ScreenInk | undefined;
function startOverlayPoll() {
  if (!inTauri()) return; // a browser preview has no window to make click-through
  document.documentElement.dataset.polled = "1"; // hover comes from here, not DOM :hover
  let through: boolean | undefined;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const askedAt = performance.now();
      const poll = await overlayPoll();
      checkDrag({ poll: { askedAt, buttonDown: poll.mouseDown } });
      const point = poll.point ? { x: poll.point[0], y: poll.point[1] } : undefined;
      const step = pttStep(ptt, poll.talkKeys && !!wizardEl.hidden, performance.now());
      ptt = step.ptt;
      if (step.act === "talk") pushToTalk(true), screenInk?.start();
      if (step.act === "release") pushToTalk(false), screenInk?.finish();
      // Hover from the cursor, not DOM hover: WebKit sends none while another app is in front.
      const h = pollHover(dock.classList.contains("hover"), mini ? undefined : point, { ...orbAt, ...dockSize() });
      if (h.hover !== dock.classList.contains("hover")) {
        dock.classList.toggle("hover", h.hover);
        updateControls();
      }
      if (h.hideTip) tips.hide();
      updatePillHover(point);
      if (following && !drag && !mini && layer === "home") {
        const next = followStep(orbAt, dockSize(), point, view());
        if (next.x !== orbAt.x || next.y !== orbAt.y) moveOrb(next);
      }
      const take = capture({ point, rects: hitRects(), hold: !!drag || !wizardEl.hidden });
      if (through !== !take) {
        through = !take;
        // The cursor left everything Jett shows: no tooltip may stay behind (ticket 39).
        if (through) tips.hide();
        await setClickThrough(through);
      }
    } catch {
      // A missed poll just waits for the next one.
    } finally {
      busy = false;
    }
  }, 50);
}

// ---- the popover (ticket 36): opened from the orb's menu, closed with X or Escape ----
const closeCenterBtn = $<HTMLButtonElement>("close-center");
let layer: Layer = startLayer;
function setLayer(action: LayerAction) {
  const next = nextLayer(layer, action);
  if (next === layer) return;
  if (next === "center" && mini) void setMini(false);
  layer = next;
  overlay.dataset.layer = layer;
  popover.hidden = layer !== "center";
  placeFloaters();
  if (layer === "center") (action === "show" ? tabBtns[panel.tab] : closeCenterBtn).focus();
  else orbEl.focus();
}
closeCenterBtn.onclick = () => setLayer("close");

const tabBtns: Record<Tab, HTMLButtonElement> = { chat: $("tab-chat"), jobs: $("tab-jobs"), brain: $("tab-brain") };
let panel: Panel = startPanel;
function feedPanel(action: PanelAction, focusTab = false) {
  panel = nextPanel(panel, action);
  renderPanel();
  if (focusTab) tabBtns[panel.tab].focus();
}
function renderPanel() {
  for (const tab of TABS) {
    const on = tab === panel.tab;
    // Settings swaps in for the tab's view; no tab shows selected meanwhile.
    tabBtns[tab].setAttribute("aria-selected", String(on && !panel.settings));
    tabBtns[tab].tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on || !!panel.settings;
  }
  $("panel-settings").hidden = !panel.settings;
  setupBtn.setAttribute("aria-pressed", String(!!panel.settings));
  if (panel.tab === "chat" && !panel.settings) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
/** Open the panel on Settings (/model, and coming back from help or setup opened there). */
function showSettings() {
  feedPanel({ type: "panel.settings", open: true });
  setLayer("open");
}
setupBtn.onclick = () => feedPanel({ type: "panel.settings" });
for (const tab of TABS) tabBtns[tab].onclick = () => feedPanel({ type: "panel.select", tab });
tabBtns.chat.parentElement!.addEventListener("keydown", (e) => {
  const tab = tabForKey(panel.tab, e.key);
  if (!tab) return;
  e.preventDefault();
  feedPanel({ type: "panel.select", tab }, true);
});
// The orb's running-jobs badge opens the popover on Jobs.
const jobsBtn = $<HTMLButtonElement>("jobs-toggle");
jobsBtn.onclick = () => {
  feedPanel({ type: "panel.jobs-button" });
  setLayer("show");
};
renderPanel();

// ---- the Shortcuts card (ticket 38): from the popover's "?", the ? key or the menu bar ----
const shortcutsEl = $("shortcuts");
/** Help opened from Settings: closing it goes back there, not to the bare orb. */
let shortcutsFromPanel = false;
function showShortcuts(on: boolean, fromPanel = false) {
  if (on) shortcutsFromPanel = fromPanel;
  if (!on && !shortcutsEl.hidden && shortcutsFromPanel) {
    shortcutsFromPanel = false;
    shortcutsEl.hidden = true;
    return showSettings();
  }
  if (on) {
    if (mini) void setMini(false);
    setLayer("close");
    $("shortcuts-title").textContent = SHORTCUTS_TITLE[lang];
    $("shortcuts-list").replaceChildren(
      ...[...SHORTCUTS[lang], ...COMMANDS.map((c) => ({ keys: c.usage, what: c.what[lang] }))].flatMap((s) => {
        const dt = document.createElement("dt");
        dt.append(Object.assign(document.createElement("kbd"), { textContent: s.keys }));
        return [dt, Object.assign(document.createElement("dd"), { textContent: s.what })];
      }),
    );
  }
  shortcutsEl.hidden = !on;
  if (on) {
    const at = placePopover({ ...orbAt, ...dockSize() }, { width: shortcutsEl.offsetWidth, height: shortcutsEl.offsetHeight }, view());
    shortcutsEl.style.left = `${at.x}px`;
    shortcutsEl.style.top = `${at.y}px`;
    // Focus the card itself (not its X, whose tooltip would cover the title); Esc closes it.
    shortcutsEl.focus();
  }
}
$<HTMLButtonElement>("set-shortcuts").onclick = () => showShortcuts(true, true);
$<HTMLButtonElement>("close-shortcuts").onclick = () => showShortcuts(false);


// ---- the call (ticket 37): like a phone call -------------------------------------
let orb: Orb = orbStart;
let call: CallPhase = "off";
let muted = false;
let shown: CallView | undefined;
let endedTimer: ReturnType<typeof setTimeout> | undefined;
let mic: ReturnType<typeof followMic> | undefined;
/** Jett's voice, followed the same way as the mic (ticket 38): the wave moves with it while speaking. */
let voice: ReturnType<typeof followMic> | undefined;
let voiceHeard = false;
/**
 * Mute while typing: the quick box open silences Jett's voice in this window. The reply
 * still comes as text (Gemini Live's output transcription, in the bubble); the model keeps
 * answering in audio, since switching it to text would need a new connection. Outside a
 * call no audio reaches the window at all, so only a live call has something to mute.
 */
const voiceEls = new Set<HTMLMediaElement>();
function muteVoice(on: boolean) {
  for (const el of voiceEls) el.muted = on;
}
/** Jett's output level, last read by the orb's wave (the pill's bars use it too). */
let voiceOut = 0;
let micLevel = 0;
// Push to talk (ticket 38): whether letting go must mute once the call connects.
let pttCall: PttCall = pttCallIdle;

// Each look has its own colour and motion, so you can tell without reading.
const LOOKS: Record<CallLook, { mood: Mood; tint: string }> = {
  starting: { mood: "off", tint: "120,255,226" },
  idle: { mood: "idle", tint: "120,255,226" },
  joining: { mood: "think", tint: "120,255,226" },
  listening: { mood: "listen", tint: "120,255,226" },
  thinking: { mood: "think", tint: "196,160,255" },
  speaking: { mood: "speak", tint: "140,206,255" },
  muted: { mood: "off", tint: "150,170,168" },
  ended: { mood: "off", tint: "150,170,168" },
  // Ticket 40: calm teal while it comes back by itself; a muted amber once out of retries.
  reconnecting: { mood: "idle", tint: "120,255,226" },
  offline: { mood: "idle", tint: "222,182,112" },
};
const BUTTON_TIPS: Record<Lang, Record<"start" | "mute" | "unmute" | "hangup", string>> = {
  en: { start: "Start call", mute: "Mute", unmute: "Unmute", hangup: "Hang up" },
  zh: { start: "开始通话", mute: "静音", unmute: "取消静音", hangup: "挂断" },
};

function render() {
  const v = callView({ orb: orb.state, call, muted, lang });
  shown = v;
  dock.dataset.look = v.look;
  orbEl.dataset.state = orb.state;
  // Words only when you must act (call-state.ts `showsWords`): the wizard closed with no
  // key, or Gemini out of reach. Idle, listening, speaking: the orb says it.
  const noKey = !finishSetupBtn.hidden;
  orbLabel.textContent = noKey ? "No key yet" : v.label;
  orbLabel.parentElement!.hidden = !noKey && !showsWords(v.look);
  retryBtn.hidden = !v.retry;
  if (v.retry) retryBtn.textContent = v.retry;
  pillEl.dataset.look = v.look;
  // The pill's quick actions follow the call buttons (pill.ts `pillActions`).
  pillList = pillActions(v.buttons);
  const callAct = v.buttons.find((b) => b !== "hangup");
  pillCallBtn.hidden = !callAct;
  if (callAct) {
    setIcon(pillCallBtn, callAct === "unmute" ? "micOff" : "mic");
    pillCallBtn.classList.toggle("start", callAct === "start");
    pillCallBtn.setAttribute("aria-pressed", String(callAct === "unmute"));
    pillCallBtn.dataset.tip = BUTTON_TIPS[lang][callAct];
    pillCallBtn.dataset.key = callAct === "start" ? "⌃⌥" : "";
    pillCallBtn.setAttribute("aria-label", BUTTON_TIPS[lang][callAct]);
    tips.refresh(pillCallBtn);
  }
  pillHangupBtn.hidden = !v.buttons.includes("hangup");
  pillHangupBtn.dataset.tip = BUTTON_TIPS[lang].hangup;
  pillHangupBtn.setAttribute("aria-label", BUTTON_TIPS[lang].hangup);
  if (pillOpen) placePillActions();
  renderHint();
  $("muted-badge").hidden = !v.mutedBadge;
  const tipsFor = BUTTON_TIPS[lang];
  // One call button: Start call, or a red Hang up in the same spot while joining or live.
  const act = callButton(v.buttons);
  talkBtn.hidden = !act;
  if (act && talkBtn.dataset.act !== act) {
    talkBtn.dataset.act = act;
    setIcon(talkBtn, act === "hangup" ? "hangup" : "mic");
    talkBtn.classList.toggle("talk", act === "start");
    talkBtn.classList.toggle("hangup", act === "hangup");
  }
  if (act) {
    talkBtn.dataset.tip = tipsFor[act];
    talkBtn.setAttribute("aria-label", tipsFor[act]);
    // Esc hangs up only when nothing else is open; Cmd+. always does.
    talkBtn.dataset.key = act === "start" ? "Space" : layer === "center" ? "⌘." : "Esc · ⌘.";
    tips.refresh(talkBtn);
  }
  // The orb opens the typing box; its name says the state too, since no words are printed.
  orbEl.setAttribute("aria-label", `${quick.open ? UI[lang].closeTyping : UI[lang].typeHere.replace("…", "")} · ${v.label}`);
  orbEl.disabled = talkBtn.disabled;
  applyLang();
  updateControls();
}
/** The faint line under "Can't reach Gemini": when the next retry is (ticket 40). */
function renderHint() {
  const hint = shown?.look === "offline" ? retryHint(orb, performance.now(), lang) : undefined;
  if (orbHint.hidden !== !hint) orbHint.hidden = !hint;
  if (orbHint.textContent !== (hint ?? "")) orbHint.textContent = hint ?? "";
}
/**
 * Retry (ticket 40). The core gone (the shell stopped restarting it): start it again; it
 * says `core-ready` and the window reconnects. Only the network gone: ask the core to try now.
 */
retryBtn.onclick = async () => {
  try {
    if (orb.coreDead || !coreRef) {
      feedOrb({ type: "core.restarting", attempt: 1, retryInMs: 0 });
      await restartCore();
    } else {
      await coreRef.reconnect();
    }
  } catch (err) {
    feedOrb({ type: "core.down" });
    showError(`retry: ${errorText(err)}`);
  }
};
// One UI language (ticket 39): every static tooltip and label follows the language you last spoke.
const UI_IDS: [string, UiKey][] = [
  ["jobs-toggle", "jobs"],
  ["pill", "showJett"], ["pill-expand", "expand"], ["tab-chat", "chat"], ["tab-jobs", "jobs"], ["tab-brain", "brain"], ["setup", "settings"],
  ["close-center", "close"], ["close-shortcuts", "close"], ["clear-canvas", "hideDrawing"],
  ["send", "send"], ["close-reader", "back"],
];
/** Words shown as text (not tooltips): Settings' titles and rows, the New chat button. */
const TEXT_IDS: [string, UiKey][] = [
  ["new-chat-text", "newChat"], ["settings-title", "settings"], ["set-model-title", "model"], ["set-voice-title", "voice"],
  ["set-window-title", "window"], ["set-help-title", "help"], ["set-shortcuts-text", "helpCommands"], ["set-setup-text", "runSetup"],
  ["show-log-text", "showLog"],
];
let wordsLang: Lang | undefined;
function applyLang() {
  if (wordsLang === lang) return;
  wordsLang = lang;
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en";
  const words = UI[lang];
  for (const [id, key] of UI_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.dataset.tip = words[key];
    el.setAttribute("aria-label", words[key]);
    tips.refresh(el);
  }
  for (const [id, key] of TEXT_IDS) $(id).textContent = words[key];
  settings?.render();
  typeInput.placeholder = words.typeHere;
  quickInput.placeholder = words.typeHere;
  quickInput.setAttribute("aria-label", words.typeHere);
  $("chats-title").textContent = words.pastChats;
  $("brain-title").textContent = words.notes;
  $("menu-new-chat").querySelector(".orb-menu-text")!.textContent = words.newChat;
  $("menu-center").querySelector(".orb-menu-text")!.textContent = words.menu;
  bubbleMore.dataset.tip = words[bubble.dataset.open === "true" ? "less" : "more"];
  showFollow();
  if (!shortcutsEl.hidden) showShortcuts(true);
}
// Less on screen at rest (ticket 39): in a call, Mute and Hang up only under the cursor or
// while someone is talking (call-state.ts `showCallButtons`).
const controlsEl = dock.querySelector<HTMLElement>(".controls")!;
const TALK_HOLD_MS = 1500;
let micHeardAt = -Infinity;
function updateControls() {
  const rest = !showCallButtons({
    look: shown?.look ?? "starting",
    inCall: call === "live" || call === "joining",
    hovered: dock.classList.contains("hover") || (!inTauri() && dock.matches(":hover")) || dock.contains(document.activeElement),
    talking: performance.now() - micHeardAt < TALK_HOLD_MS,
  });
  if (controlsEl.dataset.rest !== String(rest)) controlsEl.dataset.rest = String(rest);
}

function feedOrb(input: OrbInput) {
  orb = nextOrb(orb, input, performance.now());
  render();
}

mountLedOrb($<HTMLCanvasElement>("orb-canvas"), {
  follow: () => LOOKS[shown?.look ?? "starting"].mood,
  tint: () => LOOKS[shown?.look ?? "starting"].tint,
  level: () => micLevel,
  // Ticket 38: the wave moves only with real activity (orb-wave.ts).
  wave: () => {
    micLevel = mic && !muted ? mic.read() : 0;
    if (micLevel > QUIET) micHeardAt = performance.now();
    const out = voice?.read() ?? 0;
    voiceOut = out;
    if (out > QUIET) voiceHeard = true;
    return waveFor({
      look: shown?.look ?? "starting",
      t: performance.now() / 1000,
      mic: micLevel,
      // Jett's own output level once it has been heard; until then, the gentle motion.
      voice: voice && voiceHeard ? out : undefined,
      still: reducedMotion,
    });
  },
});

let transcript: Transcript = emptyTranscript;
function renderTranscript() {
  // Only the last line changes on a chunk, so patch the tail instead of redrawing.
  const lines = transcript.lines;
  while (transcriptEl.children.length > lines.length) transcriptEl.lastElementChild?.remove();
  lines.forEach((line, i) => {
    let li = transcriptEl.children[i] as HTMLLIElement | undefined;
    if (!li) li = transcriptEl.appendChild(document.createElement("li"));
    const cls = line.role === "note" ? "note" : line.role;
    if (li.className !== cls) li.className = cls;
    if (li.textContent !== line.text) li.textContent = line.text;
  });
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ---- live captions (ticket 37) ----------------------------------------------------
let captions: Captions = noCaptions;
// The cues beside the orb (ticket 37): equaliser / working pill and the speech bubble.
let work: Work = noWork;
const cuePill = $("cue-pill");
const cuePillText = $("cue-pill-text");
const bubble = $("bubble");
const bubbleText = $("bubble-text");
const bubbleMore = $<HTMLButtonElement>("bubble-more");
bubbleMore.onclick = () => {
  const open = bubble.dataset.open !== "true";
  bubble.dataset.open = String(open);
  bubbleMore.setAttribute("aria-expanded", String(open));
  bubbleMore.setAttribute("aria-label", open ? "Fold the reply" : "Show the whole reply");
  bubbleMore.dataset.tip = UI[lang][open ? "less" : "more"];
  placeFloaters();
};
const drawingShown = () => stage.dataset.view === "sketch" && stage.dataset.dismissed !== "true";
function renderCaptions() {
  const now = performance.now();
  const drawing = drawingShown();
  const cues = cuesFor({
    look: shown?.look ?? "starting",
    working: work.running.at(-1)?.label,
    caption: shownCaptions(captions, now, Infinity),
    drawing,
  });
  // The drawing's one caption bar (sketch-view.ts): what is being said now, from the
  // voice's transcription, one sentence at a time; it clears once Jett's voice stops.
  sketch?.setCaption(drawing ? barLine(captions, now, !!orb.audio) : undefined);
  cuePill.hidden = !cues.pill;
  if (cues.pill) {
    cuePill.dataset.kind = cues.pill.kind;
    // Your newest words matter most: a long line keeps its end.
    const full = cues.pill.text ?? "";
    const text = full.length > 38 ? `…${full.slice(-37).trimStart()}` : full;
    if (cuePillText.textContent !== text) cuePillText.textContent = text;
    cuePillText.hidden = !text;
  }
  bubble.hidden = !cues.bubble;
  if (cues.bubble) {
    if (bubbleText.textContent !== cues.bubble.text) {
      bubbleText.textContent = cues.bubble.text;
      bubble.dataset.open = "false";
      bubbleMore.setAttribute("aria-expanded", "false");
    }
    // A reply longer than the fold, or one that runs past three lines here, gets the chevron.
    bubbleMore.hidden = !(cues.bubble.long || bubbleText.scrollHeight > bubbleText.clientHeight + 2 || bubble.dataset.open === "true");
  }
}
// The equaliser bars move with your voice.
const bars = [...document.querySelectorAll<HTMLElement>(".eq i")];
(function eq() {
  if (!cuePill.hidden && cuePill.dataset.kind === "listen") {
    const lvl = micLevel; // read once a frame by the orb's wave
    const t = performance.now() / 1000;
    bars.forEach((b, i) => (b.style.transform = `scaleY(${(0.25 + lvl * (0.55 + 0.45 * Math.abs(Math.sin(t * 7 + i * 1.7)))).toFixed(3)})`));
  }
  requestAnimationFrame(eq);
})();
// The pill's mini level bars (ticket 39): the same honest wave as the orb (pill.ts `pillBars`).
const pillBarEls = [...pillEl.querySelectorAll<HTMLElement>(".pill-bars i")];
(function pillMeter() {
  if (mini && !pillEl.hidden) {
    const t = performance.now() / 1000;
    const w = waveFor({ look: shown?.look ?? "starting", t, mic: micLevel, voice: voice && voiceHeard ? voiceOut : undefined, still: reducedMotion });
    pillBars(w, t, reducedMotion).forEach((h, i) => {
      const el = pillBarEls[i];
      if (el) el.style.transform = `scaleY(${h})`;
    });
    pillEl.dataset.dim = String(w.dim);
  }
  requestAnimationFrame(pillMeter);
})();
// ---- New chat (ticket 39): menu bar, the orb's hover button, the popover, Cmd+N --------
const toastEl = $("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short note by the orb (or the pill when minimised), gone after a moment. */
function toast(text: string) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  const by = mini ? pillRect() : { ...orbAt, ...dockSize() };
  const w = toastEl.offsetWidth;
  const h = toastEl.offsetHeight;
  const leftOf = by.x + by.width / 2 > innerWidth / 2;
  const at = keepOn({ x: leftOf ? by.x - w - 10 : by.x + by.width + 10, y: by.y + (mini ? by.height / 2 - h / 2 : 30) }, { width: w, height: h }, view());
  toastEl.style.left = `${at.x}px`;
  toastEl.style.top = `${at.y}px`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1600);
}
let newChatBusy = false;
/** The core saves this chat (its note and tidy job) and starts fresh; its `chat.started` clears the captions, transcript and drawing. */
async function startNewChat() {
  if (!coreRef || newChatBusy) return;
  newChatBusy = true;
  newChatBtn.disabled = true;
  try {
    await coreRef.newChat();
  } catch (err) {
    showError(`new chat: ${errorText(err)}`);
  } finally {
    newChatBusy = false;
    newChatBtn.disabled = false;
  }
}

// ---- the orb's menu: right-click (or the context-menu key / Shift+F10) on the orb ----
const orbMenu = $("orb-menu");
const menuItems = [...orbMenu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
function showOrbMenu(at: Point | undefined) {
  tips.hide();
  orbMenu.hidden = false;
  const r = orbEl.getBoundingClientRect();
  const p = at ?? { x: r.right - 8, y: r.top + r.height / 2 };
  const spot = keepOn({ x: p.x + 2, y: p.y + 2 }, { width: orbMenu.offsetWidth, height: orbMenu.offsetHeight }, view());
  orbMenu.style.left = `${spot.x}px`;
  orbMenu.style.top = `${spot.y}px`;
  menuItems[0]?.focus();
}
function hideOrbMenu(focusOrb = false) {
  if (orbMenu.hidden) return;
  orbMenu.hidden = true;
  if (focusOrb) orbEl.focus();
}
orbEl.addEventListener("contextmenu", (e) => {
  e.preventDefault(); // no WebKit Reload / Inspect menu
  if (mini || !coreRef) return;
  // A keyboard-opened menu (no pointer position) sits beside the orb.
  showOrbMenu(e.button === 2 || e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined);
});
// Anywhere else: no WebKit menu over Jett's own bits either.
dock.addEventListener("contextmenu", (e) => e.preventDefault());
orbMenu.addEventListener("contextmenu", (e) => e.preventDefault());
$<HTMLButtonElement>("menu-new-chat").onclick = () => {
  hideOrbMenu();
  void startNewChat();
};
$<HTMLButtonElement>("menu-center").onclick = () => {
  hideOrbMenu();
  setLayer(layer === "center" ? "close" : "open");
};
orbMenu.addEventListener("keydown", (e) => {
  const i = menuItems.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = menuItems.length;
    menuItems[(i + (e.key === "ArrowDown" ? 1 : n - 1)) % n]?.focus();
  } else if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    hideOrbMenu(true);
  }
});
// A press outside the menu, or the window losing focus, closes it.
window.addEventListener("pointerdown", (e) => {
  if (!orbMenu.hidden && !orbMenu.contains(e.target as Node)) hideOrbMenu();
}, true);
window.addEventListener("blur", () => hideOrbMenu());

// ---- quick typing (ticket 40): type to Jett without the popover --------------------
const quickEl = $<HTMLFormElement>("quick");
const quickInput = $<HTMLTextAreaElement>("quick-input");
let quick: Quick = quickClosed;
function placeQuick() {
  if (quickEl.hidden) return;
  const by = mini ? pillRect() : { ...orbAt, ...dockSize() };
  // With the command list open the box is taller; quickPlace flips it above the orb when
  // the screen ends first, so the list never covers the orb.
  const at = quickPlace(by, { width: quickEl.offsetWidth, height: quickEl.offsetHeight }, view(), mini ? pillSpot.side : undefined);
  quickEl.style.left = `${at.x}px`;
  quickEl.style.top = `${at.y}px`;
}
function feedQuick(action: QuickAction) {
  const step = nextQuick(quick, action);
  const wasOpen = quick.open;
  quick = step.quick;
  quickEl.hidden = !quick.open;
  orbEl.setAttribute("aria-expanded", String(quick.open));
  if (quick.open !== wasOpen) {
    muteVoice(quick.open);
    render();
  }
  if (quickInput.value !== quick.text) quickInput.value = quick.text;
  if (quick.open && !wasOpen) {
    placeQuick();
    quickInput.focus();
    quickInput.setSelectionRange(quick.text.length, quick.text.length);
  }
  if (!quick.open && wasOpen) quickInput.blur();
  if (step.focus && inTauri()) void quickTypeFocus(step.focus === "take").catch(() => {});
  renderSlash();
  // A slash command runs here; it never goes to Gemini as text.
  if (step.send && !runSlash(step.send)) void sendTyped(step.send);
}

// ---- slash commands (slash.ts): "/" in the type box lists them under the field ----
const slashEl = $<HTMLUListElement>("quick-slash");
let slashRows: Suggestion[] = [];
let slashActive = 0;
/** Esc hid the list for this text; typing brings it back. */
let slashHiddenFor: string | undefined;
/** /help: the whole list stays up, titled, until you type. */
let slashHelp = false;
function renderSlash() {
  const text = quick.open ? quick.text : "";
  slashRows = slashHelp ? suggest("/", lang) : text === slashHiddenFor ? [] : suggest(text, lang, settings?.voices());
  slashActive = Math.min(slashActive, Math.max(0, slashRows.length - 1));
  slashEl.hidden = !slashRows.length;
  quickInput.setAttribute("aria-expanded", String(!!slashRows.length));
  slashEl.replaceChildren(
    ...(slashHelp ? [Object.assign(document.createElement("li"), { className: "slash-head", role: "presentation", textContent: UI[lang].commands })] : []),
    ...slashRows.map((row, i) => {
      const li = document.createElement("li");
      li.id = `slash-${i}`;
      li.className = "slash-row";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === slashActive));
      li.append(
        Object.assign(document.createElement("span"), { className: "slash-cmd", textContent: row.label }),
        Object.assign(document.createElement("span"), { className: "slash-what", textContent: row.detail }),
      );
      li.onpointerdown = (e) => e.preventDefault(); // keep the caret in the field
      li.onclick = () => pickSlash(row);
      return li;
    }),
  );
  if (slashRows.length) quickInput.setAttribute("aria-activedescendant", `slash-${slashActive}`);
  else quickInput.removeAttribute("aria-activedescendant");
  placeQuick();
}
function pickSlash(row: Suggestion) {
  slashHelp = false;
  if (row.run) return feedQuick({ type: "input", text: "" }), void runSlash(row.insert);
  quickInput.value = row.insert;
  feedQuick({ type: "input", text: row.insert });
  quickInput.setSelectionRange(row.insert.length, row.insert.length);
}
/** Run a slash command. False: not one, so the text goes to Jett as usual. */
function runSlash(text: string, from: "quick" | "panel" = "quick"): boolean {
  const parsed = parseSlash(text);
  if (!parsed) return false;
  slashHelp = false;
  if ("unknown" in parsed) {
    toast(`${parsed.unknown}: ${UI[lang].unknownCommand}`);
  } else if (parsed.cmd === "clear") {
    // Wipe the drawing now (also when a turn holds New chat back), then save this chat and start fresh.
    sketch?.clearAll();
    void startNewChat();
  } else if (parsed.cmd === "voice") {
    if (!parsed.arg && from === "panel") {
      showSettings();
    } else if (!parsed.arg) {
      // No name yet: show the voices to pick from.
      feedQuick({ type: "input", text: "/voice " });
      quickInput.value = "/voice ";
    } else {
      void settings?.setVoice(parsed.arg).then((ok) => ok || toast(`${parsed.arg}: ${UI[lang].voiceUnknown}`));
    }
  } else if (parsed.cmd === "model") {
    feedQuick({ type: "close" });
    showSettings();
    settings?.focusModel();
  } else if (parsed.cmd === "help" && from === "panel") {
    showShortcuts(true, true);
  } else if (parsed.cmd === "help") {
    slashHelp = true;
    renderSlash();
  }
  return true;
}
/** A typed turn from the quick field: the reply shows in the bubble; the box stays open, so it is not spoken. */
async function sendTyped(text: string) {
  if (!coreRef) return showError(UI[lang].typeHere);
  feedOrb({ type: "turn.sent" });
  try {
    await coreRef.sendText(text);
  } catch (err) {
    showError(errorText(err));
    feedOrb({ type: "turn.done", reply: "" });
  }
}
quickInput.addEventListener("input", () => {
  slashHelp = false;
  feedQuick({ type: "input", text: quickInput.value });
  // Grow with the text, up to a few lines.
  quickInput.style.height = "auto";
  quickInput.style.height = `${Math.min(96, quickInput.scrollHeight)}px`;
});
quickInput.addEventListener("keydown", (e) => {
  if (e.isComposing) return; // an IME is still picking characters
  // The command list first: arrows move, Tab or Enter picks, Esc hides it.
  if (slashRows.length) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      slashActive = moveActive(slashActive, slashRows.length, e.key);
      return renderSlash();
    }
    const row = slashRows[slashActive];
    // Enter on text that is already a whole command runs what was typed (e.g. "/voice calm").
    const typedWhole = !!row && quick.text.trim().toLowerCase() === row.insert.trim().toLowerCase();
    if (row && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !typedWhole))) {
      e.preventDefault();
      return pickSlash(row);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      slashHelp = false;
      slashHiddenFor = quick.text;
      return renderSlash();
    }
  }
  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
    e.preventDefault();
    e.stopPropagation();
    feedQuick({ type: "key", key: e.key, shift: e.shiftKey });
  }
});
quickEl.onsubmit = (e) => e.preventDefault();
// You clicked into another app: the field closes, and the keyboard stays where you went.
window.addEventListener("blur", () => {
  if (!quick.open) return;
  quick = quickClosed;
  quickEl.hidden = true;
  orbEl.setAttribute("aria-expanded", "false");
  muteVoice(false);
  render();
});
void onQuickType(() => feedQuick({ type: "open" })).catch(() => {});
// Starting to type while Jett has focus opens the field with that first letter.
window.addEventListener("keydown", (e) => {
  if (!wizardEl.hidden || quick.open || e.defaultPrevented || e.isComposing) return;
  const t = e.target as HTMLElement;
  if (!isQuickTypeStart(e, !!t.closest?.("input, textarea, select, [contenteditable]"))) return;
  e.preventDefault();
  feedQuick({ type: "open", seed: e.key });
});

/** A line the window says itself (the greeting, new chat), shown as Jett's caption. */
function say(text: string) {
  captions = { model: { text, at: performance.now() }, closed: true };
  renderCaptions();
}
setInterval(() => {
  renderCaptions();
  updateControls();
  if (orb.retryAt !== undefined) renderHint(); // "retrying in 5s" counts down
  if (orb.heardAt !== undefined) feedOrb({ type: "tick" });
}, 200);

// Why a helper: anything can be thrown; the window shows it as one line.
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
// A problem the window itself hit (not a core event): one note line in the transcript, and a caption.
function showError(message: string) {
  transcript = addToTranscript(transcript, { type: "error", message });
  renderTranscript();
  say(message);
}

// ---- voice: LiveKit room as "user" ----------------------------------------
let room: Room | undefined;

async function startCall(core: CoreClient) {
  clearTimeout(endedTimer);
  call = "joining";
  muted = false;
  render();
  try {
    const s = await core.session();
    if (call !== "joining") return; // hung up while connecting
    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (track, _pub, who) => {
      if (track.kind !== Track.Kind.Audio || who.identity !== "agent") return;
      const el = track.attach();
      el.muted = quick.open; // typing: you read the reply, nothing plays
      voiceEls.add(el);
      document.body.appendChild(el);
      // Follow Jett's voice for the wave (ticket 38). If Web Audio can't read the remote
      // track, the level stays 0 and the orb falls back to the gentle speaking motion.
      try {
        voice?.stop();
        voice = followMic(track.mediaStreamTrack);
        voiceHeard = false;
      } catch {
        voice = undefined;
      }
    });
    // The agent's voice still playing keeps the orb on "speaking" after the text is done.
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const agentTalking = speakers.some((p) => p.identity === "agent");
      if (agentTalking !== !!orb.audio) feedOrb({ type: "agent.audio", speaking: agentTalking });
    });
    room.on(RoomEvent.Disconnected, () => void endCall(false));
    await room.connect(s.livekitUrl, s.token);
    if (call !== "joining") return void (await room.disconnect()); // hung up while connecting
    await room.startAudio(); // inside the click: WebKit's autoplay rule
    // First call asks macOS for the mic (Info.plist NSMicrophoneUsageDescription).
    await room.localParticipant.setMicrophoneEnabled(true);
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (track) mic = followMic(track);
    call = "live";
    // Ctrl+Option let go while this was connecting (ticket 38): the release wins, mute now.
    const muteNow = pttCall.muteOnLive;
    pttCall = { ...pttCall, muteOnLive: false };
    render();
    if (muteNow) await setMuted(true);
  } catch (err) {
    await room?.disconnect();
    room = undefined;
    pttCall = pttCallIdle;
    call = "off";
    render();
    showError(`mic: ${errorText(err)}`);
  }
}

async function endCall(disconnect = true) {
  if (call === "off" || call === "ended") return;
  const r = room;
  room = undefined;
  mic?.stop();
  mic = undefined;
  voice?.stop();
  voice = undefined;
  for (const el of voiceEls) el.remove();
  voiceEls.clear();
  pttCall = pttCallIdle;
  muted = false;
  call = "ended";
  render();
  if (disconnect) await r?.disconnect();
  clearTimeout(endedTimer);
  endedTimer = setTimeout(() => {
    if (call === "ended") (call = "off"), render();
  }, 2500);
}

// Mute (ticket 37): the mic track stops in the window; the core keeps running.
async function setMuted(on: boolean) {
  if (call !== "live" || !room) return;
  muted = on;
  render();
  await room.localParticipant.setMicrophoneEnabled(!on).catch((err) => showError(`mic: ${errorText(err)}`));
}

// ---- push to talk (ticket 37): hold Ctrl+Option, let go to send ----------------
// The press opens the mic (starting a call if there is none) and brings Jett back if
// minimised. Letting go mutes it again, unless the mic was already open before the
// press; let go while the call is still connecting and it mutes once connected
// (overlay.ts `pttPress` / `pttRelease`, ticket 38).
function pushToTalk(on: boolean) {
  if (!coreRef) return;
  if (on) {
    // Minimised, the pill shows listening; no need to expand (ticket 39).
    const step = pttPress(pttCall, call, muted);
    pttCall = step.state;
    if (step.act === "start") void startCall(coreRef);
    else if (step.act === "unmute") void setMuted(false);
    render();
  } else {
    const step = pttRelease(pttCall, call);
    pttCall = step.state;
    if (step.act === "mute") void setMuted(true);
  }
  dock.classList.toggle("ptt", on);
  pillEl.classList.toggle("ptt", on);
}

// ---- keys: Space = start / mute, Cmd+. = hang up, Esc closes what is open, else hangs up ----
let coreRef: CoreClient | undefined;
function primary() {
  if (!coreRef) return;
  const act = spaceAction(call, muted);
  if (act === "start") void startCall(coreRef);
  else if (act) void setMuted(act === "mute");
}
// The orb: a click (not the end of a drag) opens the typing box, or closes it; a little
// later so a double-click can minimise instead (overlay.ts `isDoubleClick`).
let lastClickAt: number | undefined;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
orbEl.onclick = () => {
  if (swallowClick) return void (swallowClick = false);
  const now = performance.now();
  if (isDoubleClick(lastClickAt, now)) {
    clearTimeout(clickTimer);
    lastClickAt = undefined;
    void setMini(true);
    return;
  }
  lastClickAt = now;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => feedQuick(quick.open ? { type: "close" } : { type: "open" }), DOUBLE_MS);
};
window.addEventListener("keydown", (e) => {
  if (!wizardEl.hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key === ".") {
    e.preventDefault();
    void endCall();
    return;
  }
  if (isNewChatKey(e)) {
    e.preventDefault();
    void startNewChat();
    return;
  }
  if (e.key === "Escape") {
    // The reader and the mode menu close themselves first (they prevent default).
    if (e.defaultPrevented) return;
    if (!shortcutsEl.hidden) return showShortcuts(false);
    if (layer === "center") return setLayer("escape");
    // Cards on screen: Esc closes them all first.
    if (sketch?.openCount()) return sketch.clearAll();
    // Jett talking: Esc stops the reply. Otherwise, in a call, it hangs up.
    if (orb.state === "speaking") return void coreRef?.stopReply().catch(() => {});
    if (call === "live" || call === "joining") void endCall();
    return;
  }
  if (e.key === "?" && !(e.target as HTMLElement).closest("input, textarea, [contenteditable]")) {
    e.preventDefault();
    showShortcuts(shortcutsEl.hidden === true);
    return;
  }
  if (e.code === "Space" && !e.repeat) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, button, [contenteditable], [role=tab]")) return;
    e.preventDefault();
    primary();
  }
});

// ---- boot -----------------------------------------------------------------

/** The wizard was closed with no Gemini key: wait for "Finish setup", then run it again. */
function finishSetupLater(info: CoreInfo): Promise<CoreClient | undefined> {
  say("Setup isn't finished. I need a Gemini key to talk.");
  finishSetupBtn.hidden = false;
  render();
  return new Promise((resolve) => {
    finishSetupBtn.onclick = async () => {
      finishSetupBtn.hidden = true;
      render();
      try {
        resolve(await runWizard(info, await getSetup(info)));
      } catch (err) {
        showError(`setup: ${errorText(err)}`);
        resolve(undefined);
      }
    };
  });
}

async function boot() {
  moveOrb(placeOrb(storedSpot(), dockSize(), view()));
  // Minimised last time: come back as the pill (tickets 38, 39).
  void setMini(load(MINI_KEY) === "1", false, false);
  startOverlayPoll();
  void onOpenPanel(() => setLayer("open")).catch(() => {});
  void onToggleMini(() => void setMini(!mini)).catch(() => {});
  void onShowShortcuts(() => showShortcuts(true)).catch(() => {});
  void onNewChat(() => void startNewChat()).catch(() => {});
  render();
  // Ticket 40: the shell restarts a core that died. Until it is back the orb says
  // Reconnecting…; once a new one is up, the page reloads to talk to its new address.
  let booted = false;
  void onCoreRestarting(({ attempt, retryInMs }) => feedOrb({ type: "core.restarting", attempt, retryInMs })).catch(() => {});
  void onCoreReady(() => {
    if (booted) location.reload();
  }).catch(() => {});
  let core: CoreClient;
  try {
    const info = await waitForCore((attempt, retryInMs) => feedOrb({ type: "core.restarting", attempt, retryInMs }));
    booted = true;
    // First launch (no config file) or no Gemini key yet: the setup wizard first.
    const status = await getSetup(info);
    let first = status.needed || status.keyNeeded ? await runWizard(info, status) : connectCore(info);
    // Closed before a key: no chat yet, so "Finish setup" under the orb opens it again.
    while (!first) first = await finishSetupLater(info);
    core = first;
  } catch (err) {
    booted = true; // a Retry that brings the core up reloads the page
    feedOrb({ type: "core.down" });
    console.error(`core did not start: ${errorText(err)}`);
    return;
  }
  coreRef = core;
  if (inTauri()) {
    screenInk = createScreenInk(core.info);
    core.onEvent((event) => screenInk?.onEvent(event));
  }
  // The shell restarts a core that dies (onCoreRestarting above); core-down means it gave up.
  void onCoreRestarting(() => void endCall()).catch(() => {});
  onCoreDown((reason) => {
    feedOrb({ type: "core.down" });
    console.error(`core stopped: ${reason}`);
    void endCall();
    talkBtn.disabled = true;
    sendBtn.disabled = true;
    typeInput.disabled = true;
    $<HTMLButtonElement>("set-setup").disabled = true;
    newChatBtn.disabled = true;
  });

  core.onEvent((event) => {
    feedOrb(event);
    transcript = addToTranscript(transcript, event);
    renderTranscript();
    captions = addCaption(captions, event, performance.now());
    work = addWork(work, event, lang);
    if (event.type === "transcript" && event.role === "user") {
      const heard = spokenLang(event.text);
      if (heard && heard !== lang) (lang = heard), render();
    }
    if (event.type === "chat.started") {
      // Fresh start: the captions and the scene clear in their own state; the drawing
      // card goes until something new is drawn; a short toast by the orb says so.
      stage.dataset.dismissed = "true";
      toast(WORDS[lang].newChat);
    }
    // Something new drawn: show the drawing again if its X hid it.
    if (event.type === "canvas.beat") delete stage.dataset.dismissed;
    // After sketch-view (mounted below) has seen it: place the drawing card, redraw the cues.
    queueMicrotask(() => {
      if (event.type === "canvas.beat") placeFloaters();
      renderCaptions();
    });
  });
  mountBoardAndBar(core, $("jobs"), $("bar"), {
    buttons: [
      { button: jobsBtn, count: $("jobs-count"), label: "Jobs" },
      { button: tabBtns.jobs, count: $("tab-jobs-count"), label: "Jobs" },
    ],
  });
  mountModePill(core, $<HTMLButtonElement>("mode-pill"), $<HTMLUListElement>("mode-menu"));
  mountApprovals(core, approvalsEl);
  const reader = mountBrainView(core, {
    tree: $<HTMLUListElement>("brain-tree"), empty: $("brain-empty"), reader: $("reader"), readerName: $("reader-name"),
    readerPath: $("reader-path"), readerText: $("reader-text"), closeReader: $<HTMLButtonElement>("close-reader"), transcript: $("brain-lists"),
  });
  mountChatView(core, reader, { list: $<HTMLUListElement>("chat-list"), empty: $("chats-empty") }, (key) => UI[lang][key], showError);
  settings = mountSettings(
    core,
    {
      models: $("set-models"), voices: $("set-voices"), modelNote: $("set-model-note"),
      chip: $<HTMLButtonElement>("model-chip"), chipLabel: $("model-chip-label"), menu: $("model-menu"),
    },
    { lang: () => lang, error: showError },
  );
  sketch = mountSketch(core, stage);
  onFrontWindowMoved(placeFloaters);
  followFrontWindow(core);
  placeFloaters();
  say(WORDS[lang].hi);
  feedOrb({ type: "core.ready" });

  talkBtn.disabled = false;
  talkBtn.onclick = () => void (talkBtn.dataset.act === "hangup" ? endCall() : startCall(core));
  typeInput.disabled = false;
  sendBtn.disabled = false;
  render();

  typeForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = "";
    if (runSlash(text, "panel")) return; // a command, not a message
    // The core echoes the text back as a user transcript event; nothing to draw here.
    feedOrb({ type: "turn.sent" });
    try {
      await core.sendText(text);
    } catch (err) {
      showError(errorText(err));
      feedOrb({ type: "turn.done", reply: "" });
    }
  };

  // Setup: the same wizard again (from Settings), starting from the settings in use.
  // Closing it comes back to Settings, where it was opened.
  const setSetupBtn = $<HTMLButtonElement>("set-setup");
  setSetupBtn.disabled = false;
  setSetupBtn.onclick = async () => {
    setSetupBtn.disabled = true;
    try {
      await endCall(); // the wizard's voice test needs the mic
      setLayer("close");
      await runWizard(core.info, await getSetup(core.info), core);
      showSettings();
    } catch (err) {
      showError(`setup: ${errorText(err)}`);
    } finally {
      setSetupBtn.disabled = false;
    }
  };

  // New chat (ticket 39): one path for every way in (startNewChat).
  newChatBtn.disabled = false;
  newChatBtn.onclick = () => void startNewChat();
}

// Dev server only (stripped from the app build): put the call in a state without a
// LiveKit room, for screenshots of the call looks in a plain browser.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __jettPreview(phase: CallPhase, isMuted = false, level = 0.7) {
      call = phase;
      muted = isMuted;
      mic = phase === "live" ? { read: () => level * (0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 180))), stop() {} } : undefined;
      render();
      renderCaptions();
    },
    /** Minimise to the pill, or bring Jett back (tickets 38, 39). */
    __jettMini(on: boolean) {
      return setMini(on, false);
    },
    /** Feed the orb an input, e.g. a `connection` reconnecting event (ticket 40 screenshots). */
    __jettOrb(input: OrbInput) {
      feedOrb(input);
    },
    /** Open or close the pill's quick actions, as the poll's hover would. */
    __jettPillHover(on: boolean) {
      setPillOpen(on);
    },
  });
}

// "Show log" works before and after the core is up (it is most useful when the core did not start).
$<HTMLButtonElement>("show-log").onclick = () => revealLog().catch((err) => showError(`show log: ${errorText(err)}`));

boot();
