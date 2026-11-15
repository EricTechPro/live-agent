// The main window. It only renders: core events in, orb + transcript out.
// No agent logic here; the core decides everything (see docs/spec.md, App shell).
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { mountBoardAndBar } from "./board-view.ts";
import { mountModePill } from "./mode-pill.ts";
import { mountApprovals } from "./approvals-view.ts";
import { mountBrainView } from "./brain-view.ts";
import { bubbleLine } from "./bubble.ts";
import { connectCore, getSetup, onCoreDown, revealLog, waitForCore, type CoreClient } from "./core-client.ts";
import { mountSketch } from "./sketch-view.ts";
import { mountTooltips, paintIcons, setIcon } from "./tooltip.ts";
import { drawsOnCanvas, nextPanel, startPanel, tabForKey, TABS, type Panel, type Tab } from "./panel.ts";
import { nextLayer, startLayer, type Layer, type LayerAction } from "./layers.ts";
import { mountLedOrb, type Mood } from "./led-orb.ts";
import { mountMini } from "./mini.ts";
import { nextOrb, orbStart, type Orb, type OrbInput, type OrbState } from "./orb-state.ts";
import { addToTranscript, emptyTranscript, type Transcript } from "./transcript.ts";
import { runWizard } from "./wizard.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
// Icon buttons (ticket 26): pixel icons from icons.ts, one shared tooltip.
paintIcons();
const tips = mountTooltips();
const orbEl = $("orb");
const orbLabel = $("orb-label");
const talkBtn = $<HTMLButtonElement>("talk");
const transcriptEl = $<HTMLOListElement>("transcript");
const typeForm = $<HTMLFormElement>("type");
const typeInput = $<HTMLInputElement>("type-input");
const setupBtn = $<HTMLButtonElement>("setup");
const pauseBtn = $<HTMLButtonElement>("pause");
const sendBtn = $<HTMLButtonElement>("send");
const sayEl = $("say");
const newChatBtn = $<HTMLButtonElement>("new-chat");

// ---- two layers (ticket 22): home and the control center ------------------
// One dock (bubble, orb, call controls) moves between the two, so the orb's canvas
// and the LiveKit room are never touched: the call keeps going on both.
const shell = $("shell");
const dock = $("dock");
const openCenterBtn = $<HTMLButtonElement>("open-center");
const closeCenterBtn = $<HTMLButtonElement>("close-center");
let layer: Layer = startLayer;
function setLayer(action: LayerAction) {
  const next = nextLayer(layer, action);
  if (next === layer) return;
  layer = next;
  shell.dataset.layer = layer;
  $("home").hidden = layer !== "home";
  $("center").hidden = layer !== "center";
  $(layer === "center" ? "chat-slot" : "home-slot").append(dock);
  // A button or Escape moves focus to the other layer's way back; "show" never steals it.
  if (action !== "show") (layer === "center" ? closeCenterBtn : openCenterBtn).focus();
  renderPanel(); // the Jobs icon's aria-expanded depends on the layer too
}
openCenterBtn.onclick = () => setLayer("open");
closeCenterBtn.onclick = () => setLayer("close");
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || !$("wizard").hidden || document.body.classList.contains("mini")) return;
  setLayer("escape");
});

// ---- right panel (ticket 25): Canvas and Jobs tabs ----------------------
const jobsBtn = $<HTMLButtonElement>("jobs-toggle");
const tabBtns: Record<Tab, HTMLButtonElement> = { canvas: $("tab-canvas"), jobs: $("tab-jobs") };
let panel: Panel = startPanel;
function feedPanel(input: Parameters<typeof nextPanel>[1], focusTab = false) {
  const next = nextPanel(panel, input);
  if (next !== panel) (panel = next), renderPanel();
  if (focusTab) tabBtns[panel.tab].focus();
}
function renderPanel() {
  $("center").dataset.panel = panel.open ? "open" : "closed";
  $("panel").hidden = !panel.open;
  for (const tab of TABS) {
    const on = tab === panel.tab;
    tabBtns[tab].setAttribute("aria-selected", String(on));
    tabBtns[tab].tabIndex = on ? 0 : -1;
    $(`panel-${tab}`).hidden = !on;
  }
  jobsBtn.setAttribute("aria-expanded", String(layer === "center" && panel.open && panel.tab === "jobs"));
}
for (const tab of TABS) tabBtns[tab].onclick = () => feedPanel({ type: "panel.select", tab });
$("tab-canvas").parentElement!.addEventListener("keydown", (e) => {
  const tab = tabForKey(panel.tab, e.key);
  if (!tab) return;
  e.preventDefault();
  feedPanel({ type: "panel.select", tab }, true);
});
$("close-panel").onclick = () => {
  feedPanel({ type: "panel.close" });
  jobsBtn.focus();
};
// The top bar's Jobs icon: from home, open the control center on Jobs; inside it, toggle the Jobs tab.
jobsBtn.onclick = () => {
  if (layer === "home") feedPanel({ type: "panel.select", tab: "jobs" }), setLayer("show");
  else feedPanel({ type: "panel.jobs-button" });
  renderPanel();
};
renderPanel();

const LABELS: Record<OrbState, string> = {
  connecting: "Starting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  offline: "Offline",
};

// ---- state -> screen ------------------------------------------------------

// The LED orb follows the orb state: listening sends a ring pulse, speaking runs the
// wave and pulses, thinking twinkles, starting/offline is dim. Idle breathes.
const ORB_MOODS: Record<OrbState, Mood> = { connecting: "off", listening: "listen", thinking: "think", speaking: "speak", offline: "off" };
// "listening" with no mic open is the resting state: the orb breathes.
mountLedOrb($<HTMLCanvasElement>("orb-canvas"), {
  follow: () => (paused ? "off" : orb.state === "listening" && !room ? "idle" : ORB_MOODS[orb.state]),
});

// The speech bubble over the orb, like the wizard's: Jett's latest short line, typed out.
let typer: ReturnType<typeof setInterval> | undefined;
function say(text: string) {
  clearInterval(typer);
  let n = 0;
  sayEl.textContent = "";
  typer = setInterval(() => {
    sayEl.textContent = text.slice(0, ++n);
    if (n >= text.length) clearInterval(typer);
  }, 24);
}

let orb: Orb = orbStart;
let transcript: Transcript = emptyTranscript;

function feedOrb(input: OrbInput) {
  const next = nextOrb(orb, input, performance.now());
  if (next.state !== orb.state) {
    orbEl.dataset.state = next.state;
    orbEl.setAttribute("aria-label", `Agent state: ${next.state}`);
    orbLabel.textContent = labelFor(next.state);
  }
  orb = next;
}

function renderTranscript() {
  // Only the last line changes on a chunk, so patch the tail instead of redrawing.
  const lines = transcript.lines;
  while (transcriptEl.children.length > lines.length) transcriptEl.lastElementChild?.remove();
  lines.forEach((line, i) => {
    let li = transcriptEl.children[i] as HTMLLIElement | undefined;
    if (!li) li = transcriptEl.appendChild(document.createElement("li"));
    const cls = line.role === "note" ? "note" : `pf ${line.role}`;
    if (li.className !== cls) li.className = cls;
    if (li.textContent !== line.text) li.textContent = line.text;
  });
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// Why a helper: anything can be thrown; the window shows it as one line.
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A problem the window itself hit (not a core event): one note line in the transcript.
function showError(message: string) {
  transcript = addToTranscript(transcript, { type: "error", message });
  renderTranscript();
}

// Time passing matters only for "you paused, so it's thinking".
setInterval(() => {
  if (orb.heardAt !== undefined) feedOrb({ type: "tick" });
}, 200);

// ---- voice: LiveKit room as "user" ----------------------------------------

let room: Room | undefined;

async function startTalking(core: CoreClient) {
  talkBtn.disabled = true;
  try {
    const s = await core.session();
    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (track, _pub, who) => {
      if (track.kind === Track.Kind.Audio && who.identity === "agent") document.body.appendChild(track.attach());
    });
    // The agent's voice still playing keeps the orb on "speaking" after the text is done.
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const agentTalking = speakers.some((p) => p.identity === "agent");
      if (agentTalking !== !!orb.audio) feedOrb({ type: "agent.audio", speaking: agentTalking });
    });
    room.on(RoomEvent.Disconnected, () => setTalking(false));
    await room.connect(s.livekitUrl, s.token);
    await room.startAudio(); // inside the click: WebKit's autoplay rule
    // First call asks macOS for the mic (Info.plist NSMicrophoneUsageDescription).
    await room.localParticipant.setMicrophoneEnabled(!paused); // paused: join, but keep the mic quiet
    setTalking(true);
  } catch (err) {
    await room?.disconnect();
    room = undefined;
    showError(`mic: ${errorText(err)}`);
    setTalking(false);
  }
}

async function stopTalking() {
  await room?.disconnect();
  room = undefined;
  setTalking(false);
}

// "Listening" only while the mic is open; with it closed Jett is just ready. Paused wins.
function labelFor(state: OrbState): string {
  if (paused && state !== "offline" && state !== "connecting") return "Paused";
  return state === "listening" && !room ? "Ready" : LABELS[state];
}

// ---- pause: Jett stops speaking and hearing; the chat and transcript stay ----
let paused = false;
function showPaused(on: boolean) {
  paused = on;
  document.body.classList.toggle("paused", on);
  // A toggle: its name stays "Pause" and aria-pressed says it is on; the icon and tip show Resume.
  setIcon(pauseBtn, on ? "play" : "pause");
  pauseBtn.dataset.tip = on ? "Resume" : "Pause";
  pauseBtn.setAttribute("aria-pressed", String(on));
  tips.refresh(pauseBtn);
  orbLabel.textContent = labelFor(orb.state);
  say(on ? "Paused." : "I'm back.");
  // The mic itself goes quiet too, so nothing leaves the Mac while paused.
  void room?.localParticipant.setMicrophoneEnabled(!on).catch(() => {});
}

function setTalking(on: boolean) {
  if (orb.state === "listening") orbLabel.textContent = labelFor(orb.state);
  talkBtn.disabled = false;
  // One button, two actions: Start call (mic) and, in a call, End call (red hang-up).
  const label = on ? "End call" : "Start call";
  setIcon(talkBtn, on ? "hangup" : "mic");
  talkBtn.setAttribute("aria-label", label);
  talkBtn.dataset.tip = label;
  talkBtn.classList.toggle("end", on);
  tips.refresh(talkBtn);
}

// ---- boot -----------------------------------------------------------------

async function boot() {
  let core: CoreClient;
  try {
    const info = await waitForCore();
    // First launch (no config file) or no Gemini key yet: the setup wizard first.
    const status = await getSetup(info);
    core = status.needed || status.keyNeeded ? await runWizard(info, status) : connectCore(info);
  } catch (err) {
    feedOrb({ type: "core.down" });
    orbLabel.textContent = `Core did not start: ${errorText(err)}`;
    return;
  }
  onCoreDown((reason) => {
    feedOrb({ type: "core.down" });
    orbLabel.textContent = `Core stopped: ${reason}`;
    talkBtn.disabled = true;
    pauseBtn.disabled = true;
    sendBtn.disabled = true;
    typeInput.disabled = true;
    setupBtn.disabled = true;
    newChatBtn.disabled = true;
  });

  core.onEvent((event) => {
    feedOrb(event);
    transcript = addToTranscript(transcript, event);
    renderTranscript();
    if (event.type === "paused") showPaused(event.paused);
    if (event.type === "turn.done" && event.reply.trim()) say(bubbleLine(event.reply));
    if (event.type === "chat.started") say("New chat!");
    // Something drawn: show it, on the Canvas tab of the control center.
    feedPanel(event);
    if (drawsOnCanvas(event)) setLayer("show"), renderPanel();
  });
  mountBoardAndBar(core, $("jobs"), $("bar"), {
    buttons: [
      { button: jobsBtn, count: $("jobs-count"), label: "Jobs" },
      { button: tabBtns.jobs, count: $("tab-jobs-count"), label: "Jobs" },
    ],
  });
  mountModePill(core, $<HTMLButtonElement>("mode-pill"), $<HTMLUListElement>("mode-menu"));
  mountApprovals(core, $("approvals"));
  mountBrainView(core, {
    tree: $<HTMLUListElement>("brain-tree"), empty: $("brain-empty"), reader: $("reader"), readerName: $("reader-name"),
    readerPath: $("reader-path"), readerText: $("reader-text"), closeReader: $<HTMLButtonElement>("close-reader"), transcript: transcriptEl,
  });
  say("Hi! I'm Jett.");
  mountMini(core, $<HTMLButtonElement>("mini"), orbEl, $("mini-count"));
  mountSketch(core, $("panel-canvas"));
  feedOrb({ type: "core.ready" });

  talkBtn.disabled = false;
  talkBtn.onclick = () => (room ? stopTalking() : startTalking(core));
  typeInput.disabled = false;
  sendBtn.disabled = false;

  // Pause / Resume, and Space for it while you are not typing.
  pauseBtn.disabled = false;
  const togglePause = () => core.pause(!paused).catch((err) => showError(`pause: ${errorText(err)}`));
  pauseBtn.onclick = togglePause;
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || !$("wizard").hidden) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, button, [contenteditable]")) return;
    e.preventDefault();
    void togglePause();
  });

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
      if (room) await stopTalking(); // the wizard's voice test needs the mic
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

// "Show log" works before and after the core is up (it is most useful when the core did not start).
$<HTMLButtonElement>("show-log").onclick = () => revealLog().catch((err) => showError(`show log: ${errorText(err)}`));

boot();
