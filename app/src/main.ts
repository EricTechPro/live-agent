// The main window. It only renders: core events in, orb + transcript out.
// No agent logic here; the core decides everything (see docs/spec.md, App shell).
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { mountBoardAndBar } from "./board-view.ts";
import {
  connectCore,
  keyNeeded,
  onCoreDown,
  openKeyPage,
  revealLog,
  sendKey,
  waitForCore,
  type CoreClient,
  type CoreInfo,
} from "./core-client.ts";
import { nextOrb, orbStart, type Orb, type OrbInput, type OrbState } from "./orb-state.ts";
import { addToTranscript, emptyTranscript, type Transcript } from "./transcript.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const orbEl = $("orb");
const orbLabel = $("orb-label");
const talkBtn = $<HTMLButtonElement>("talk");
const transcriptEl = $<HTMLOListElement>("transcript");
const typeForm = $<HTMLFormElement>("type");
const typeInput = $<HTMLInputElement>("type-input");
const setupBtn = $<HTMLButtonElement>("setup");
const newChatBtn = $<HTMLButtonElement>("new-chat");

const LABELS: Record<OrbState, string> = {
  connecting: "Starting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  offline: "Offline",
};

// ---- state -> screen ------------------------------------------------------

let orb: Orb = orbStart;
let transcript: Transcript = emptyTranscript;

function feedOrb(input: OrbInput) {
  const next = nextOrb(orb, input, performance.now());
  if (next.state !== orb.state) {
    orbEl.dataset.state = next.state;
    orbEl.setAttribute("aria-label", `Agent state: ${next.state}`);
    orbLabel.textContent = LABELS[next.state];
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
    if (li.className !== line.role) li.className = line.role;
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
    await room.localParticipant.setMicrophoneEnabled(true);
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

function setTalking(on: boolean) {
  talkBtn.disabled = false;
  talkBtn.textContent = on ? "Stop talking" : "Start talking";
  talkBtn.setAttribute("aria-pressed", String(on));
}

// ---- boot -----------------------------------------------------------------

// First launch with no Gemini key: show the key screen until the core takes one.
// The pasted key goes straight to the core and is cleared from the input; the
// window keeps no copy (ticket 19, docs/adr/0002).
function askForKey(info: CoreInfo): Promise<void> {
  const screen = $("key-screen");
  const form = $<HTMLFormElement>("key-form");
  const input = $<HTMLInputElement>("key-input");
  const save = $<HTMLButtonElement>("key-save");
  const error = $("key-error");
  $("key-link").onclick = (e) => {
    e.preventDefault();
    openKeyPage().catch(() => {});
  };
  screen.hidden = false;
  input.focus();
  orbLabel.textContent = "Waiting for your Gemini key";
  return new Promise((resolve) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      input.value = "";
      save.disabled = input.disabled = true;
      error.textContent = "Checking your key…";
      try {
        await sendKey(info, key);
        screen.hidden = true;
        resolve();
      } catch (err) {
        error.textContent = errorText(err);
        input.focus();
      } finally {
        save.disabled = input.disabled = false;
      }
    };
  });
}

async function boot() {
  let core: CoreClient;
  try {
    const info = await waitForCore();
    if (await keyNeeded(info)) await askForKey(info);
    core = connectCore(info);
  } catch (err) {
    feedOrb({ type: "core.down" });
    orbLabel.textContent = `Core did not start: ${errorText(err)}`;
    return;
  }
  onCoreDown((reason) => {
    feedOrb({ type: "core.down" });
    orbLabel.textContent = `Core stopped: ${reason}`;
    talkBtn.disabled = true;
    typeInput.disabled = true;
    setupBtn.disabled = true;
    newChatBtn.disabled = true;
  });

  core.onEvent((event) => {
    feedOrb(event);
    transcript = addToTranscript(transcript, event);
    renderTranscript();
  });
  mountBoardAndBar(core, $("jobs"), $("bar"));
  feedOrb({ type: "core.ready" });

  talkBtn.disabled = false;
  talkBtn.onclick = () => (room ? stopTalking() : startTalking(core));
  typeInput.disabled = false;
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

  // The setup chat (ticket 12). Its questions and answers are ordinary turns
  // (typed or spoken); these two calls only start it.
  setupBtn.disabled = false;
  setupBtn.onclick = () => runSetup(core, false);
  // First launch: the core starts setup only if there is no config file yet.
  runSetup(core, true);

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

async function runSetup(core: CoreClient, ifNeeded: boolean) {
  try {
    await core.startSetup(ifNeeded);
  } catch (err) {
    showError(`setup: ${errorText(err)}`);
  }
}

// "Show log" works before and after the core is up (it is most useful when the core did not start).
$<HTMLButtonElement>("show-log").onclick = () => revealLog().catch((err) => showError(`show log: ${errorText(err)}`));

boot();
