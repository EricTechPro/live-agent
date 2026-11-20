// The setup wizard (Jett setup): a click-through over the main view.
//
//   const core = await runWizard(info, await getSetup(info), existingCore);
//
// The × (or Esc) closes it at any step and keeps what was saved so far. It then
// resolves with the client, or undefined when there is still no Gemini key: the
// window offers "Finish setup" (main.ts), and a launch without a config shows it again.
//
// Shows on a first launch (no config file, or no Gemini key) and from the Setup
// button. Steps: welcome (voice) -> key (only without one) -> mic -> notes ->
// tone -> safety -> say hi (a real voice test, then a recap) -> done.
// Answers go to the core as typed values (POST /setup/save): no model reads them,
// so nothing can be misheard. The rules (steps, recap, answers) live in
// wizard-flow.ts; this file only draws them and talks to the core.
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import type { AgentEvent } from "../../src/core/events.ts";
import {
  connectCore,
  openKeyPage,
  pickFolder,
  pickPartFolder,
  saveSetup,
  scanFolder,
  sendKey,
  type CoreClient,
  type CoreInfo,
  type SetupStatus,
} from "./core-client.ts";
import {
  answersFrom,
  folderMessage,
  initialState,
  MODES,
  PARTS,
  partStatus,
  recapRows,
  SAMPLE_BRAIN,
  STEP_ICONS,
  STEP_LINES,
  stepReady,
  CAN_DO,
  TRY_ME,
  TONES,
  VOICES,
  wizardSteps,
  type Part,
  type StepName,
  type WizardState,
} from "./wizard-flow.ts";
import { mountLedOrb, type Mood } from "./led-orb.ts";
import { sortForPart } from "../../src/setup/parts.ts";

// The dropdown's last option: the native picker, opening in the notes folder.
const PICK_OTHER = "\u0000pick";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ADVANCE_MS = 750;

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const led = (kind: "on" | "busy") => `<span class="led ${kind}"></span>`;

let orb: ReturnType<typeof mountLedOrb> | undefined;

/**
 * Show the wizard and resolve with the core client once the user presses
 * "Open Jett" or closes it. `core` is the running client when there is one (Setup
 * button); without one (no key yet) it is made once the key works, and closing
 * before that resolves undefined.
 */
export function runWizard(info: CoreInfo, status: SetupStatus, core?: CoreClient): Promise<CoreClient | undefined> {
  const root = $("wizard");
  orb ??= mountLedOrb($<HTMLCanvasElement>("w-orb"));
  const state: WizardState = initialState(status.current, status.keyNeeded);
  const steps = wizardSteps(status.keyNeeded);
  const sections = [...root.querySelectorAll<HTMLElement>(".step")];
  const section = (name: StepName | "end") => sections.find((s) => s.dataset.name === name)!;
  let client = status.keyNeeded ? undefined : (core ?? connectCore(info));
  let cur = 0;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let saved = false;
  let pickToken = 0;
  let done: (core: CoreClient | undefined) => void = () => {};
  const finished = new Promise<CoreClient | undefined>((resolve) => (done = resolve));

  // ---- the speech bubble: types out letter by letter --------------------------
  let typer: ReturnType<typeof setInterval> | undefined;
  function say(text: string, mood?: Mood, secs = 0.6) {
    clearInterval(typer);
    const el = $("w-say");
    let n = 0;
    el.textContent = "";
    typer = setInterval(() => {
      el.textContent = text.slice(0, ++n);
      if (n >= text.length) clearInterval(typer);
    }, 24);
    if (mood) orb!.set(mood, secs);
  }

  function msg(id: string, kind: "ok" | "bad" | "wait" | "", html: string) {
    const el = $(id);
    el.className = `msg${kind ? ` ${kind}` : ""}`;
    el.innerHTML = html;
  }

  // ---- steps -------------------------------------------------------------------
  const bar = $("w-progress");
  bar.replaceChildren(...steps.map(() => document.createElement("li")));
  const name = () => steps[cur]!;

  function render() {
    clearTimeout(advanceTimer);
    const step = name();
    for (const s of sections) s.hidden = s.dataset.name !== step;
    [...bar.children].forEach((li, i) => (li.className = i < cur ? "done" : i === cur ? "now" : ""));
    if (step !== "test") void hangUp();
    $("w-nav").hidden = false;
    orb!.icon(STEP_ICONS[step]);
    say(STEP_LINES[step]);
    $("w-back").style.visibility = cur ? "visible" : "hidden";
    $("w-skip").hidden = !section(step).dataset.skip;
    $("w-next").textContent = section(step).dataset.next ?? "Continue";
    if (step === "mic") void checkMic();
    if (step === "notes" && state.notes === "folder" && !state.tree && state.notesPath) void scan(state.notesPath, true);
    if (step === "test") void saveAndTest();
    refresh();
  }
  const refresh = () => ($<HTMLButtonElement>("w-next").disabled = !stepReady(name(), state, saved));
  // A finished choice moves on by itself after a beat, so you see it light up first.
  function advanceSoon(ms = ADVANCE_MS) {
    refresh();
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      if (cur < steps.length - 1 && stepReady(name(), state, saved)) {
        cur++;
        render();
      }
    }, ms);
  }
  const go = (step: StepName) => {
    const i = steps.indexOf(step);
    if (i >= 0) {
      cur = i;
      render();
    }
  };

  $("w-next").onclick = () => {
    if (cur === steps.length - 1) return finish();
    cur++;
    render();
  };
  $("w-back").onclick = () => {
    if (cur) {
      cur--;
      render();
    }
  };
  $("w-skip").onclick = () => {
    cur++;
    render();
  };

  function radio(selector: string, onPick: (b: HTMLElement) => void) {
    const items = [...root.querySelectorAll<HTMLElement>(selector)];
    for (const b of items) {
      b.onclick = () => {
        for (const x of items) x.setAttribute("aria-checked", String(x === b));
        onPick(b);
      };
    }
  }
  const check = (attr: string, value: string) =>
    root.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute("aria-checked", String(b.getAttribute(attr) === value)));

  // ---- welcome: the voice ------------------------------------------------------
  $("w-voices").innerHTML = VOICES.map(
    (v) => `<button class="pf chip" type="button" role="radio" aria-checked="${v.id === state.voice}" data-voice="${v.id}">${v.label}</button>`,
  ).join("");
  radio("[data-voice]", (b) => {
    state.voice = b.dataset.voice!;
    saved = false;
    say(VOICES.find((v) => v.id === state.voice)!.line, "speak", 1.2);
  });

  // ---- key -----------------------------------------------------------------------
  const keyInput = $<HTMLInputElement>("w-key-input");
  const keyCheck = $<HTMLButtonElement>("w-key-check");
  keyInput.value = "";
  keyInput.disabled = keyCheck.disabled = false;
  msg("w-key-msg", "", "");
  $("w-get-key").onclick = () => {
    openKeyPage().catch(() => {});
    say("Copy it, then paste here");
  };
  // The key goes straight to the core and is cleared from the input; the window keeps no copy.
  $<HTMLFormElement>("w-key-form").onsubmit = async (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    if (!key) {
      msg("w-key-msg", "bad", "Paste a key first.");
      say("Hmm. Paste it here?", "listen", 1);
      return;
    }
    keyInput.value = "";
    keyInput.disabled = keyCheck.disabled = true;
    msg("w-key-msg", "wait", `${led("busy")}Checking…`);
    try {
      await sendKey(info, key);
      client = connectCore(info);
      listen(client);
      state.key = true;
      msg("w-key-msg", "ok", `${led("on")}Key works. Saved.`);
      say("Ooh, a brain!", "hype");
      advanceSoon(900);
    } catch (err) {
      keyInput.disabled = keyCheck.disabled = false;
      msg("w-key-msg", "bad", esc(errorText(err)));
      say("Hmm. Try again?", "listen", 1);
      keyInput.focus();
    }
  };

  // ---- mic: the real macOS prompt ------------------------------------------------
  const allowHtml = '<button class="pf btn go small" type="button" id="w-mic-allow">Allow</button>';
  function micAllowed(auto: boolean) {
    state.mic = true;
    $("w-mic-row").classList.add("ok");
    $("w-mic-sub").textContent = "I can hear you.";
    $("w-mic-side").innerHTML = `<span class="status">${led("on")}Allowed</span>`;
    if (auto) {
      say("I can hear you!", "hype");
      advanceSoon(900);
    } else refresh();
  }
  $("w-mic-side").innerHTML = allowHtml;
  async function checkMic() {
    if (state.mic) return;
    try {
      const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (perm?.state === "granted") micAllowed(false);
    } catch {}
  }
  $("w-mic-side").onclick = async (e) => {
    if ((e.target as HTMLElement).id !== "w-mic-allow") return;
    $("w-mic-side").innerHTML = `<span class="status wait">${led("busy")}Waiting</span>`;
    try {
      // The first call shows macOS's mic prompt (Info.plist NSMicrophoneUsageDescription).
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      micAllowed(true);
    } catch {
      $("w-mic-side").innerHTML = allowHtml;
      $("w-mic-sub").textContent = "Mic is blocked. Turn it on in System Settings, Privacy, Microphone. Or skip and type.";
      say("No mic? Typing works!", "listen", 1);
    }
  };

  // ---- notes: sample, or my folder mapped onto the brain's parts -----------------
  function showFolderSub() {
    $("w-folder-sub").textContent = state.notes === "folder" && state.notesPath ? state.notesPath : "Opens Finder on your Mac.";
  }
  check("data-notes", state.notes ?? "");
  showFolderSub();
  $("w-brain").hidden = true;
  msg("w-notes-msg", "", "");

  function renderBrain() {
    const tree = state.tree;
    const brain = state.brain!;
    $("w-brain-src").textContent = tree?.name ?? state.notesPath;
    const names = tree?.folders.map((f) => f.name) ?? [];
    // Likely matches first, then the rest; a nested pick stays listed; the picker last.
    const opts = (part: Part, sel: string) =>
      `<option value=""${sel ? "" : " selected"}>Create new</option>` +
      sortForPart(part, [...new Set([...names, ...(sel && !names.includes(sel) ? [sel] : [])])])
        .map((f) => `<option value="${esc(f)}"${f === sel ? " selected" : ""}>${esc(f)}</option>`)
        .join("") +
      `<option value="${PICK_OTHER}">Choose another folder…</option>`;
    $("w-slots").innerHTML = PARTS.map((part) => {
      const m = brain[part];
      const has = !!m.folder;
      return (
        `<li class="slot"><span class="led${has ? " on" : ""}"></span><b>${part}</b>` +
        `<span class="pf sel"><select data-slot="${part}" aria-label="Folder for ${part}">${opts(part, m.folder)}</select></span>` +
        `<span class="st${has ? " ok" : ""}">${esc(partStatus(m, tree))}</span></li>`
      );
    }).join("");
    $("w-slots")
      .querySelectorAll<HTMLSelectElement>("select")
      .forEach((s) => {
        s.onchange = async () => {
          const part = s.dataset.slot as Part;
          let folder = s.value;
          if (folder === PICK_OTHER) {
            say("Pick it in Finder");
            try {
              const picked = await pickPartFolder(info, state.notesPath);
              if (!picked) return renderBrain(); // cancelled: keep what was there
              folder = picked;
            } catch (err) {
              msg("w-notes-msg", "bad", esc(errorText(err)));
              return renderBrain();
            }
          }
          state.brain![part] = { folder, found: false };
          saved = false;
          renderBrain();
          $("w-slots").querySelector<HTMLSelectElement>(`select[data-slot="${part}"]`)?.focus();
        };
      });
    $("w-brain").hidden = false;
  }

  async function scan(path: string, keepMap: boolean) {
    const tok = ++pickToken;
    msg("w-notes-msg", "wait", `${led("busy")}Counting notes…`);
    try {
      const { tree, parts } = await scanFolder(info, path);
      if (tok !== pickToken) return;
      state.notes = "folder";
      state.notesPath = tree.path;
      state.tree = tree;
      if (!keepMap || !state.brain) state.brain = parts;
      saved = false;
      showFolderSub();
      const m = folderMessage(tree, state.brain);
      msg("w-notes-msg", "ok", `${led("on")}${esc(m.msg)}`);
      if (!keepMap) say(m.say, "hype", 1);
      renderBrain();
    } catch (err) {
      if (tok !== pickToken) return;
      msg("w-notes-msg", "bad", esc(errorText(err)));
    }
    refresh(); // no auto-advance here: the map needs a look first
  }

  radio("[data-notes]", async (b) => {
    clearTimeout(advanceTimer);
    const tok = ++pickToken;
    saved = false;
    if (b.dataset.notes === "sample") {
      state.brain = state.tree = null;
      $("w-brain").hidden = true;
      state.notes = "sample";
      state.notesPath = SAMPLE_BRAIN;
      showFolderSub();
      try {
        const { tree } = await scanFolder(info, SAMPLE_BRAIN);
        if (tok !== pickToken) return;
        msg("w-notes-msg", "ok", `${led("on")}${tree.notes} sample notes ready.`);
        say("Fun! Let us play.", "hype");
        advanceSoon();
      } catch {
        if (tok !== pickToken) return;
        state.notes = null;
        check("data-notes", "");
        msg("w-notes-msg", "bad", "The sample notes are missing. Use your own folder.");
        refresh();
      }
      return;
    }
    // "Use my folder": the native picker; nothing changes until a folder is picked.
    msg("w-notes-msg", "wait", `${led("busy")}Finder is open…`);
    say("Pick it in Finder");
    try {
      const path = await pickFolder(info);
      if (tok !== pickToken) return;
      if (!path) {
        check("data-notes", state.notes ?? "");
        msg("w-notes-msg", "wait", "No folder picked.");
        say("No worries. Pick again?");
        return refresh();
      }
      await scan(path, false);
    } catch (err) {
      if (tok !== pickToken) return;
      check("data-notes", state.notes ?? "");
      msg("w-notes-msg", "bad", esc(errorText(err)));
      refresh();
    }
  });

  // ---- tone and safety ---------------------------------------------------------
  check("data-tone", state.tone);
  check("data-mode", state.mode);
  radio("[data-tone]", (b) => {
    state.tone = b.dataset.tone as WizardState["tone"];
    saved = false;
    say(TONES[state.tone].line, "speak", 1);
    advanceSoon();
  });
  radio("[data-mode]", (b) => {
    state.mode = b.dataset.mode as WizardState["mode"];
    saved = false;
    say(MODES[state.mode].line, "hype");
    advanceSoon();
  });

  // ---- say hi: save, then a real voice test through the live Gemini session ------
  const talkBtn = $<HTMLButtonElement>("w-talk");
  const meter = $("w-meter");
  const bars = [...meter.children] as HTMLElement[];
  const heard = $("w-heard");
  let room: Room | undefined;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  let speaking = false;
  let you: HTMLParagraphElement | undefined;
  let me: HTMLParagraphElement | undefined;

  const talkMsg = (kind: "ok" | "bad" | "wait", html: string) => msg("w-talk-msg", kind, html);
  function talkUI(st: "idle" | "starting" | "listening") {
    talkBtn.textContent = st === "idle" ? (talkBtn.dataset.used ? "Talk again" : "Talk") : "Stop";
    talkBtn.disabled = st === "starting" || !saved;
    meter.classList.toggle("on", st === "listening");
    clearInterval(meterTimer);
    for (const b of bars) b.style.height = "2px";
    if (st === "listening") {
      meterTimer = setInterval(() => bars.forEach((b) => (b.style.height = `${2 + Math.random() * (speaking ? 14 : 4)}px`)), 90);
      talkMsg("ok", `${led("busy")}Listening. Tap Stop when done.`);
      say("I'm listening…", "listen", 600);
    } else if (st === "starting") talkMsg("wait", `${led("busy")}Starting mic…`);
    else talkMsg("wait", "Mic is off");
  }

  function line(cls: "you" | "me", text: string) {
    const p = Object.assign(document.createElement("p"), { className: cls, textContent: text });
    heard.append(p);
    return p;
  }
  // The core's own events draw the test: what it heard, and its answer.
  let listening: (() => void) | undefined;
  function listen(c: CoreClient) {
    listening?.();
    listening = c.onEvent((event: AgentEvent) => {
      if (root.hidden || name() !== "test") return;
      if (event.type === "transcript" && event.role === "user") {
        if (!you || me) {
          heard.replaceChildren();
          me = undefined;
          you = line("you", "You: ");
        }
        you.textContent += event.text;
        orb!.set("listen", 1);
      } else if (event.type === "transcript" && event.role === "model") {
        me ??= line("me", "Me: ");
        me.textContent += event.text;
        orb!.set("speak", 1.4);
      } else if (event.type === "turn.done" && event.reply.trim()) {
        const first = event.reply.trim().split("\n")[0]!;
        say(first.length <= 28 ? first : state.tone === "short" ? "Heard you." : "Loud and clear!", "speak", 1.4);
        you = undefined;
      } else if (event.type === "error") {
        talkMsg("bad", esc(event.message));
      }
    });
  }
  if (client) listen(client);

  async function saveAndTest() {
    renderRecap();
    if (saved) return;
    talkUI("idle");
    talkBtn.disabled = true;
    talkMsg("wait", `${led("busy")}Saving your setup…`);
    try {
      await saveSetup(info, answersFrom(state));
      saved = true;
      talkUI("idle");
    } catch (err) {
      talkMsg("bad", `${esc(errorText(err))} Use Change below.`);
      say("Hmm. Fix one thing?", "listen", 1);
    }
    refresh();
  }

  async function hangUp() {
    clearInterval(meterTimer);
    const r = room;
    room = undefined;
    speaking = false;
    if (r) await r.disconnect().catch(() => {});
    if (name() === "test") talkUI("idle");
  }

  talkBtn.onclick = async () => {
    if (room) return hangUp();
    if (!client) return;
    talkBtn.dataset.used = "1";
    heard.replaceChildren();
    you = me = undefined;
    talkUI("starting");
    const r = new Room();
    room = r;
    try {
      const s = await client.session();
      r.on(RoomEvent.TrackSubscribed, (track, _pub, who) => {
        if (track.kind === Track.Kind.Audio && who.identity === "agent") root.appendChild(track.attach());
      });
      r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        speaking = speakers.some((p) => p.identity === "user");
      });
      r.on(RoomEvent.Disconnected, () => {
        if (room === r) void hangUp();
      });
      await r.connect(s.livekitUrl, s.token);
      await r.startAudio(); // inside the click: WebKit's autoplay rule
      await r.localParticipant.setMicrophoneEnabled(true);
      if (room === r) {
        state.mic = true;
        talkUI("listening");
      }
    } catch (err) {
      await hangUp();
      $<HTMLFormElement>("w-type-row").hidden = false;
      talkMsg("bad", `Voice failed: ${esc(errorText(err))}. Type below.`);
      say("Hmm? Type it?", "listen", 1);
    }
  };

  $("w-type-open").onclick = () => {
    $<HTMLFormElement>("w-type-row").hidden = false;
    $("w-type-open").hidden = true;
    $<HTMLInputElement>("w-type-input").focus();
  };
  $<HTMLFormElement>("w-type-row").onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>("w-type-input");
    const text = input.value.trim();
    if (!/[\p{L}\p{N}]/u.test(text) || !client || !saved) return input.focus();
    input.value = "";
    heard.replaceChildren();
    you = me = undefined;
    say("Thinking…", "speak", 30);
    try {
      await client.sendText(text);
    } catch (err) {
      talkMsg("bad", esc(errorText(err)));
    }
  };

  function renderRecap() {
    const dl = $("w-recap");
    dl.replaceChildren();
    for (const row of recapRows(state)) {
      dl.append(
        Object.assign(document.createElement("dt"), { textContent: row.label }),
        Object.assign(document.createElement("dd"), { textContent: row.value, title: row.value }),
      );
      if (!steps.includes(row.step)) {
        dl.append(document.createElement("span"));
        continue;
      }
      const b = Object.assign(document.createElement("button"), { className: "link", type: "button", textContent: "Change" });
      b.onclick = () => go(row.step);
      dl.append(b);
    }
  }

  // ---- done -----------------------------------------------------------------------
  function finish() {
    if (!saved || !client) return;
    void hangUp();
    for (const s of sections) s.hidden = s.dataset.name !== "end";
    [...bar.children].forEach((li) => (li.className = "done"));
    $("w-nav").hidden = true;
    orb!.icon(STEP_ICONS.end);
    say("All set!", "hype", 1);
    $("w-try").focus();
  }
  // Leave: "Open Jett", the × or Esc. Whatever was saved stays saved; nothing more is.
  function leave() {
    clearTimeout(advanceTimer);
    clearInterval(typer);
    void hangUp();
    listening?.();
    document.removeEventListener("keydown", onKey);
    root.hidden = true;
    root.querySelectorAll("audio").forEach((a) => a.remove());
    done(client);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || root.hidden || e.defaultPrevented || e.isComposing) return;
    e.preventDefault();
    leave();
  }
  document.addEventListener("keydown", onKey);
  $("w-open").onclick = leave;
  // "Here's what I can do": the list, and Try me out sends a first turn that draws.
  $("w-can-do").replaceChildren(
    ...CAN_DO.map(({ what, say: line }) => {
      const li = Object.assign(document.createElement("li"), { textContent: what });
      li.append(Object.assign(document.createElement("span"), { className: "note", textContent: ` "${line}"` }));
      return li;
    }),
  );
  $("w-try").onclick = () => {
    const c = client;
    leave();
    if (c) setTimeout(() => void c.sendText(TRY_ME).catch(() => {}), 400);
  };
  $("w-close").onclick = leave;

  // ---- start ---------------------------------------------------------------------
  heard.replaceChildren();
  $<HTMLFormElement>("w-type-row").hidden = true;
  $("w-type-open").hidden = false;
  delete talkBtn.dataset.used;
  $("w-mic-row").classList.remove("ok");
  $("w-mic-sub").textContent = "So you can talk to me.";
  root.hidden = false;
  render();
  return finished;
}
