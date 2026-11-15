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
  connectCore, getSetup, inTauri, onCoreDown, onOpenPanel, onShowShortcuts, onToggleMini, overlayPoll, revealLog, setClickThrough, setTrayShown,
  waitForCore, type CoreClient,
} from "./core-client.ts";
import { waveFor, QUIET } from "./orb-wave.ts";
import { SHORTCUTS, SHORTCUTS_TITLE } from "./shortcuts.ts";
import { addWork, cuesFor, noWork, type Work } from "./cues.ts";
import { mountSketch } from "./sketch-view.ts";
import { mountTooltips, paintIcons, setIcon } from "./tooltip.ts";
import { nextPanel, startPanel, tabForKey, TABS, type Panel, type PanelAction, type Tab } from "./panel.ts";
import { nextLayer, startLayer, type Layer, type LayerAction } from "./layers.ts";
import { mountLedOrb, type Mood } from "./led-orb.ts";
import { nextOrb, orbStart, type Orb, type OrbInput } from "./orb-state.ts";
import { addToTranscript, emptyTranscript, type Transcript } from "./transcript.ts";
import { callView, spaceAction, talkHint, type CallLook, type CallPhase, type CallView } from "./call-state.ts";
import { addCaption, noCaptions, shownCaptions, type Captions } from "./captions.ts";
import { spokenLang, WORDS, type Lang } from "./lang.ts";
import { followMic } from "./mic-follow.ts";
import {
  capture, DOUBLE_MS, dotFor, dragTo, dropDot, followStep, hoverOrb, isDoubleClick, isDrag, keepOn, parseSaved, placeCard, placeOrb, placePopover,
  pttCallIdle, pttIdle, pttPress, pttRelease, pttStep, type PttCall, type Point, type Ptt, type Rect,
} from "./overlay.ts";
import { runWizard } from "./wizard.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// Icon buttons (ticket 26): pixel icons from icons.ts, one shared tooltip.
paintIcons();
const tips = mountTooltips();
const overlay = $("overlay");
const dock = $("dock");
const orbEl = $<HTMLButtonElement>("orb");
const orbLabel = $("orb-label");
const orbHint = $("orb-hint");
const talkBtn = $<HTMLButtonElement>("talk");
const muteBtn = $<HTMLButtonElement>("mute");
const hangupBtn = $<HTMLButtonElement>("hangup");
const transcriptEl = $<HTMLOListElement>("transcript");
const typeForm = $<HTMLFormElement>("type");
const typeInput = $<HTMLInputElement>("type-input");
const setupBtn = $<HTMLButtonElement>("setup");
const sendBtn = $<HTMLButtonElement>("send");
const newChatBtn = $<HTMLButtonElement>("new-chat");
const popover = $("popover");
const approvalsEl = $("approvals");
const stage = $("stage");
const wizardEl = $("wizard");

// ---- the orb's spot: drag it by the grip; it stays where you leave it ----------
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
  if (save) {
    try {
      localStorage.setItem(ORB_KEY, JSON.stringify(at));
    } catch {
      // Storage can be off; the orb just starts in the corner next time.
    }
  }
}
// ---- the minimised dot (ticket 38): a small faint dot that stays where you drop it ----
const MINI_KEY = "jett.mini";
const DOT_KEY = "jett.dot";
const DOT = { width: 20, height: 20 };
const dotEl = $<HTMLButtonElement>("dot");
let dotAt: Point = { x: 0, y: 0 };
let mini = false;
const load = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage off: defaults
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; works for this run.
  }
};
function moveDot(at: Point, save = false) {
  dotAt = at;
  dotEl.style.left = `${at.x}px`;
  dotEl.style.top = `${at.y}px`;
  if (save) store(DOT_KEY, JSON.stringify(at));
}
/** Minimise to the dot (minus, double-click, Ctrl+Option+S, the menu bar) or bring Jett back. */
function setMini(on: boolean, save = true) {
  mini = on;
  overlay.dataset.mini = String(on);
  dotEl.hidden = !on;
  if (on) {
    setLayer("close");
    showShortcuts(false);
    tips.refresh(dotEl);
    const saved = parseSaved(load(DOT_KEY));
    moveDot(saved ? dropDot(saved, DOT, view()) : dotFor({ ...orbAt, ...dockSize() }, DOT, view()));
  } else {
    moveOrb(keepOn(orbAt, dockSize(), view()));
  }
  if (save) store(MINI_KEY, on ? "1" : "0");
  void setTrayShown(!on).catch(() => {});
}
$<HTMLButtonElement>("hide").onclick = () => setMini(true);

// ---- dragging (ticket 38): press and move drags the whole orb, the grip or the dot; a
// press without movement is still a click (overlay.ts `isDrag`). ----
const grip = $<HTMLButtonElement>("grip");
let drag: { what: "orb" | "dot"; el: HTMLElement; start: Point; from: Point; moved: boolean } | undefined;
/** A drag just ended on this press: the click that follows it is swallowed. */
let swallowClick = false;
function pressDrag(el: HTMLElement, what: "orb" | "dot", e: PointerEvent, now = false) {
  if (e.button !== 0) return;
  swallowClick = false;
  drag = { what, el, start: what === "dot" ? dotAt : orbAt, from: { x: e.clientX, y: e.clientY }, moved: now };
  el.setPointerCapture(e.pointerId);
  if (now) (what === "dot" ? dotEl : dock).classList.add("dragging");
}
function moveDrag(e: PointerEvent) {
  if (!drag) return;
  const now = { x: e.clientX, y: e.clientY };
  if (!drag.moved) {
    if (!isDrag(drag.from, now)) return;
    drag.moved = true;
    (drag.what === "dot" ? dotEl : dock).classList.add("dragging");
  }
  if (drag.what === "orb") moveOrb(dragTo(drag.start, drag.from, now, dockSize(), view()));
  else {
    const x = Math.max(0, Math.min(innerWidth - DOT.width, drag.start.x + now.x - drag.from.x));
    const y = Math.max(0, Math.min(innerHeight - DOT.height, drag.start.y + now.y - drag.from.y));
    moveDot({ x, y });
  }
}
function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = undefined;
  dock.classList.remove("dragging");
  dotEl.classList.remove("dragging");
  if (!d.moved) return;
  swallowClick = true;
  if (d.what === "orb") moveOrb(orbAt, true);
  else moveDot(dropDot(dotAt, DOT, view()), true);
}
for (const [el, what, now] of [[grip, "orb", true], [orbEl, "orb", false], [dotEl, "dot", false]] as const) {
  el.addEventListener("pointerdown", (e) => pressDrag(el, what, e, now));
  el.addEventListener("pointermove", moveDrag);
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}
// The dot: a click (not a drag) brings Jett back.
dotEl.addEventListener("click", () => {
  if (swallowClick) return void (swallowClick = false);
  setMini(false);
});
// The grip moves by keyboard too: arrow keys, Shift for bigger steps.
grip.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 80 : 20;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  moveOrb(keepOn({ x: orbAt.x + d[0]!, y: orbAt.y + d[1]! }, dockSize(), view()), true);
});
addEventListener("resize", () => moveOrb(keepOn(orbAt, dockSize(), view())));

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
  cuesEl.style.top = `${orbAt.y + 26 + 56}px`;
  // The drawing card goes in the empty half of the screen.
  if (stage.offsetWidth) {
    const at = placeCard(orbRect, { width: stage.offsetWidth, height: stage.offsetHeight }, view());
    stage.style.left = `${at.x}px`;
    stage.style.top = `${at.y}px`;
  }
}
new MutationObserver(() => {
  // A question for you brings Jett back from the dot: approvals sit beside the orb.
  if (mini && !approvalsEl.hidden) setMini(false);
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
function showFollow() {
  followBtn.setAttribute("aria-pressed", String(following));
  followBtn.dataset.tip = following ? "Stay where I put it" : "Follow my pointer";
  tips.refresh(followBtn);
}
followBtn.onclick = () => {
  following = !following;
  showFollow();
  if (!following) moveOrb(orbAt, true);
  try {
    localStorage.setItem(FOLLOW_KEY, following ? "1" : "0");
  } catch {
    // Not remembered; works for this run.
  }
};
showFollow();

/**
 * One poll, about 20 times a second (Tauri only): click-through on or off for where the
 * cursor is, push to talk (hold Ctrl+Option), and following the pointer if chosen.
 */
let ptt: Ptt = pttIdle;
function startOverlayPoll() {
  if (!inTauri()) return; // a browser preview has no window to make click-through
  let through: boolean | undefined;
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const poll = await overlayPoll();
      const point = poll.point ? { x: poll.point[0], y: poll.point[1] } : undefined;
      const step = pttStep(ptt, poll.talkKeys && !!wizardEl.hidden, performance.now());
      ptt = step.ptt;
      if (step.act === "talk") pushToTalk(true);
      if (step.act === "release") pushToTalk(false);
      // Hover from the cursor, not DOM hover: WebKit sends none while another app is in front.
      dock.classList.toggle("hover", !mini && hoverOrb(point, { ...orbAt, ...dockSize() }));
      dotEl.classList.toggle("hover", mini && hoverOrb(point, { ...dotAt, ...DOT }, 6));
      if (following && !drag && !mini && layer === "home") {
        const next = followStep(orbAt, dockSize(), point, view());
        if (next.x !== orbAt.x || next.y !== orbAt.y) moveOrb(next);
      }
      const take = capture({ point, rects: hitRects(), hold: !!drag || !wizardEl.hidden });
      if (through !== !take) {
        through = !take;
        await setClickThrough(through);
      }
    } catch {
      // A missed poll just waits for the next one.
    } finally {
      busy = false;
    }
  }, 50);
}

// ---- the popover (ticket 36): opened from the menu button, closed with X or Escape ----
const openCenterBtn = $<HTMLButtonElement>("open-center");
const closeCenterBtn = $<HTMLButtonElement>("close-center");
let layer: Layer = startLayer;
function setLayer(action: LayerAction) {
  const next = nextLayer(layer, action);
  if (next === layer) return;
  if (next === "center" && mini) setMini(false);
  layer = next;
  overlay.dataset.layer = layer;
  popover.hidden = layer !== "center";
  openCenterBtn.setAttribute("aria-expanded", String(layer === "center"));
  placeFloaters();
  if (layer === "center") (action === "show" ? tabBtns[panel.tab] : closeCenterBtn).focus();
  else openCenterBtn.focus();
}
openCenterBtn.onclick = () => setLayer(layer === "center" ? "close" : "open");
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
    tabBtns[tab].setAttribute("aria-selected", String(on));
    tabBtns[tab].tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on;
  }
  if (panel.tab === "chat") transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
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
function showShortcuts(on: boolean) {
  if (on) {
    if (mini) setMini(false);
    setLayer("close");
    $("shortcuts-title").textContent = SHORTCUTS_TITLE[lang];
    $("shortcuts-list").replaceChildren(
      ...SHORTCUTS[lang].flatMap((s) => {
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
$<HTMLButtonElement>("open-shortcuts").onclick = () => showShortcuts(true);
$<HTMLButtonElement>("close-shortcuts").onclick = () => showShortcuts(false);

// The drawing on the screen: its X hides it until something new is drawn.
$("clear-canvas").onclick = () => {
  stage.dataset.dismissed = "true";
  renderCaptions();
};

// ---- the call (ticket 37): like a phone call -------------------------------------
let orb: Orb = orbStart;
let call: CallPhase = "off";
let muted = false;
let lang: Lang = "en";
let shown: CallView | undefined;
let endedTimer: ReturnType<typeof setTimeout> | undefined;
let mic: ReturnType<typeof followMic> | undefined;
/** Jett's voice, followed the same way as the mic (ticket 38): the wave moves with it while speaking. */
let voice: ReturnType<typeof followMic> | undefined;
let voiceHeard = false;
let micLevel = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Push to talk (ticket 38): how often it has been used (the hint goes after two), and
// whether letting go must mute once the call connects.
const PTT_USES_KEY = "jett.pttUses";
let pttUses = Number(load(PTT_USES_KEY)) || 0;
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
  offline: { mood: "off", tint: "255,150,130" },
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
  orbLabel.textContent = v.label;
  dotEl.dataset.look = v.look;
  // The faint "or hold ⌃⌥" under Tap to talk, until push to talk has been used twice.
  const hint = talkHint(v.look, lang, pttUses);
  orbHint.hidden = !hint;
  orbHint.textContent = hint ?? "";
  $("muted-badge").hidden = !v.mutedBadge;
  const tipsFor = BUTTON_TIPS[lang];
  talkBtn.hidden = !v.buttons.includes("start");
  talkBtn.dataset.tip = tipsFor.start;
  talkBtn.setAttribute("aria-label", tipsFor.start);
  const muteAction = v.buttons.find((b) => b === "mute" || b === "unmute");
  muteBtn.hidden = !muteAction;
  if (muteAction) {
    setIcon(muteBtn, muteAction === "unmute" ? "micOff" : "mic");
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", tipsFor.mute);
    muteBtn.dataset.tip = tipsFor[muteAction];
    tips.refresh(muteBtn);
  }
  hangupBtn.hidden = !v.buttons.includes("hangup");
  hangupBtn.dataset.tip = tipsFor.hangup;
  hangupBtn.setAttribute("aria-label", tipsFor.hangup);
  // Esc hangs up only when nothing else is open; Cmd+. always does.
  hangupBtn.dataset.key = layer === "center" ? "⌘." : "Esc · ⌘.";
  // The orb does what the first call button does: start, or mute / unmute.
  const first = v.buttons[0];
  orbEl.setAttribute("aria-label", first ? tipsFor[first === "hangup" ? "hangup" : first] : v.label);
  orbEl.disabled = !first || talkBtn.disabled;
  // The orb's tip names what a click does, its key, and the double-click.
  orbEl.dataset.tip = `${first ? tipsFor[first] : v.label} · ${MINIMISE_TIP[lang]}`;
  orbEl.dataset.key = first === "hangup" ? "⌘." : "Space";
  tips.refresh(orbEl);
}
const MINIMISE_TIP: Record<Lang, string> = { en: "double-click to minimise", zh: "双击最小化" };

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
    const out = voice?.read() ?? 0;
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
const capUser = $("cap-user");
const capModel = $("cap-model");
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
  bubbleMore.dataset.tip = open ? "Less" : "More";
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
  // The bottom caption bar: only while a drawing is on screen.
  const bar = shownCaptions(captions, now);
  $("captions").hidden = !cues.bar;
  for (const [el, text] of [[capUser, bar.user], [capModel, bar.model]] as const) {
    if (text && el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  }
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
/** A line the window says itself (the greeting, new chat), shown as Jett's caption. */
function say(text: string) {
  captions = { model: { text, at: performance.now() }, closed: true };
  renderCaptions();
}
setInterval(() => {
  renderCaptions();
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
    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (track, _pub, who) => {
      if (track.kind !== Track.Kind.Audio || who.identity !== "agent") return;
      document.body.appendChild(track.attach());
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
    if (mini) setMini(false);
    const step = pttPress(pttCall, call, muted);
    pttCall = step.state;
    if (step.act === "start") void startCall(coreRef);
    else if (step.act === "unmute") void setMuted(false);
    if (pttUses < 99) store(PTT_USES_KEY, String(++pttUses));
    render();
  } else {
    const step = pttRelease(pttCall, call);
    pttCall = step.state;
    if (step.act === "mute") void setMuted(true);
  }
  dock.classList.toggle("ptt", on);
}

// ---- keys: Space = start / mute, Cmd+. = hang up, Esc closes what is open, else hangs up ----
let coreRef: CoreClient | undefined;
function primary() {
  if (!coreRef) return;
  const act = spaceAction(call, muted);
  if (act === "start") void startCall(coreRef);
  else if (act) void setMuted(act === "mute");
}
// The orb: a click (not the end of a drag) does the first call button's job, a little
// later so a double-click can minimise instead (overlay.ts `isDoubleClick`).
let lastClickAt: number | undefined;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
orbEl.onclick = () => {
  if (swallowClick) return void (swallowClick = false);
  const now = performance.now();
  if (isDoubleClick(lastClickAt, now)) {
    clearTimeout(clickTimer);
    lastClickAt = undefined;
    setMini(true);
    return;
  }
  lastClickAt = now;
  clearTimeout(clickTimer);
  clickTimer = setTimeout(primary, DOUBLE_MS);
};
muteBtn.onclick = () => void setMuted(!muted);
hangupBtn.onclick = () => void endCall();
window.addEventListener("keydown", (e) => {
  if (!wizardEl.hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key === ".") {
    e.preventDefault();
    void endCall();
    return;
  }
  if (e.key === "Escape") {
    // The reader and the mode menu close themselves first (they prevent default).
    if (e.defaultPrevented) return;
    if (!shortcutsEl.hidden) return showShortcuts(false);
    if (layer === "center") return setLayer("escape");
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

async function boot() {
  moveOrb(placeOrb(storedSpot(), dockSize(), view()));
  // Minimised last time: come back as the dot (ticket 38).
  setMini(load(MINI_KEY) === "1", false);
  startOverlayPoll();
  void onOpenPanel(() => setLayer("open")).catch(() => {});
  void onToggleMini(() => setMini(!mini)).catch(() => {});
  void onShowShortcuts(() => showShortcuts(true)).catch(() => {});
  render();
  let core: CoreClient;
  try {
    const info = await waitForCore();
    // First launch (no config file) or no Gemini key yet: the setup wizard first.
    const status = await getSetup(info);
    core = status.needed || status.keyNeeded ? await runWizard(info, status) : connectCore(info);
  } catch (err) {
    feedOrb({ type: "core.down" });
    say(`Core did not start: ${errorText(err)}`);
    return;
  }
  coreRef = core;
  onCoreDown((reason) => {
    feedOrb({ type: "core.down" });
    say(`Core stopped: ${reason}`);
    void endCall();
    talkBtn.disabled = true;
    sendBtn.disabled = true;
    typeInput.disabled = true;
    setupBtn.disabled = true;
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
    if (event.type === "chat.started") say(WORDS[lang].newChat);
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
  mountChatView(core, reader, { list: $<HTMLUListElement>("chat-list"), empty: $("chats-empty") });
  mountSketch(core, stage);
  say(WORDS[lang].hi);
  feedOrb({ type: "core.ready" });

  talkBtn.disabled = false;
  talkBtn.onclick = () => void startCall(core);
  typeInput.disabled = false;
  sendBtn.disabled = false;
  render();

  typeForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = typeInput.value.trim();
    if (!text) return;
    typeInput.value = "";
    // The core echoes the text back as a user transcript event; nothing to draw here.
    feedOrb({ type: "turn.sent" });
    try {
      await core.sendText(text);
    } catch (err) {
      showError(errorText(err));
      feedOrb({ type: "turn.done", reply: "" });
    }
  };

  // Setup: the same wizard again, starting from the settings in use.
  setupBtn.disabled = false;
  setupBtn.onclick = async () => {
    setupBtn.disabled = true;
    try {
      await endCall(); // the wizard's voice test needs the mic
      setLayer("close");
      await runWizard(core.info, await getSetup(core.info), core);
    } catch (err) {
      showError(`setup: ${errorText(err)}`);
    } finally {
      setupBtn.disabled = false;
    }
  };

  // New chat: the core saves this one (its note and tidy job) and starts fresh;
  // the transcript clears on the core's `chat.started`.
  newChatBtn.disabled = false;
  newChatBtn.onclick = async () => {
    newChatBtn.disabled = true;
    try {
      await core.newChat();
    } catch (err) {
      showError(`new chat: ${errorText(err)}`);
    } finally {
      newChatBtn.disabled = false;
    }
  };
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
    /** Minimise to the dot, or bring Jett back (ticket 38). */
    __jettMini(on: boolean) {
      setMini(on, false);
    },
  });
}

// "Show log" works before and after the core is up (it is most useful when the core did not start).
$<HTMLButtonElement>("show-log").onclick = () => revealLog().catch((err) => showError(`show log: ${errorText(err)}`));

boot();
