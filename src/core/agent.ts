// The agent core: the single entry point the app and the tests use.
//
//   const session = await startSession({ model });
//   session.onEvent((e) => ...);              // every event, as it happens
//   const events = await session.sendText("hi");  // or: just this turn's events
//   await session.close();
//
// Why this shape: a text turn is the same conversation without a microphone,
// so every test can drive the real core through text alone (the same trick as
// live-dj's smoke_live).
//
// Voice (ticket 08): `sendAudio` streams the mic in; there is no "start turn"
// call, because the model decides when the user has spoken. The first thing
// the model says back about it (what it heard, or its reply) opens a voice
// turn, and that turn puts the very same events on the stream as a text turn.
// The model's voice itself comes out of `onAudio`, not the event stream: it is
// binary and high-rate, and the stream stays plain JSON.
//
// This file wires the session together. Each idea lives in its own module:
//   turn.ts        one exchange at a time, and when it is over
//   tool-calls.ts  the door every tool call goes through (gate, run, answer, jobs)
//   approvals.ts   calls waiting for the user's yes, typed or spoken
//   chat-end.ts    the note every chat leaves in the brain
//   jobs.ts        background jobs (helpers, tidy) with states and cancel
//   safety.ts      the gate's mode table
import { existsSync } from "node:fs";
import { brainRoot, type BrainFolders } from "../brain/index.ts";
import { tidyJob, type TidyModel } from "../brain/tidy.ts";
import { defaultConfig, defaultConfigPath, type Config } from "../config/index.ts";
import { errorMessage } from "../errors.ts";
import type { HelperPaths } from "../helpers/cli-job.ts";
import { createBoard } from "./board.ts";
import { saveChatNote, SUMMARY_REQUEST, summaryCollector, type ChatLine, type SummaryCollector } from "./chat-end.ts";
import type { AgentEvent } from "./events.ts";
import { joinText } from "./join-text.ts";
import { createJobs, type Jobs } from "./jobs.ts";
import type { Model, ModelEvent } from "./model.ts";
import { loadTools } from "./registry.ts";
import { nextMode, type SafetyMode, type SafetyOverrides } from "./safety.ts";
import type { Tool } from "./tool.ts";
import { createToolCalls } from "./tool-calls.ts";
import { systemInstruction } from "./tone.ts";
import { newTurn, turnIsOver, type Turn } from "./turn.ts";
import type { Eyes } from "../screen/eyes.ts";
import { createScreen, type ReleaseInput, type Screen } from "../screen/service.ts";
import type { Pt } from "../screen/geometry.ts";

/** A mic chunk with someone talking in it (not room hum): any sample past ~8% of full scale. */
export function isVoice(data: Int16Array, threshold = 2600): boolean {
  for (let k = 0; k < data.length; k++) if (Math.abs(data[k]!) > threshold) return true;
  return false;
}

export interface SessionOptions {
  /** Which model to talk to: `geminiLiveModel(...)` for real, `scriptedModel(...)` in tests. */
  model: Model;
  /** The loaded config (`loadConfig()`). Default: `defaultConfig()`. The gate reads `config.safety`. */
  config?: Config;
  /** Shortcut that wins over `config.safety.mode` (handy in tests). */
  mode?: SafetyMode;
  /** Shortcut that wins over `config.safety.overrides`, e.g. `{ read_file: "ask" }`. */
  overrides?: SafetyOverrides;
  /** Where relative file paths start. Default: the current folder. */
  workDir?: string;
  /** The tools folder to load. Default: the repo's `tools/`. */
  toolsDir?: string;
  /** Use exactly these tools instead of loading a folder (handy in tests). */
  tools?: Tool[];
  /** How long `close()` waits for the model's chat summary before using the plain transcript. Default 8000. */
  summaryTimeoutMs?: number;
  /** The config file the setup wizard writes. Default: `defaultConfigPath()`. */
  configPath?: string;
  /** Save a chat-end note into the brain on `close()`. Default true. */
  chatEndNote?: boolean;
  /** Where helper CLIs live (tests point these at fake scripts). */
  helpers?: HelperPaths;
  /**
   * Tidies new raw notes into wiki pages after each chat (`geminiTidyModel(...)`).
   * Unset: no tidy job. See src/brain/tidy.ts.
   */
  tidy?: TidyModel;
  /**
   * End the chat on its own after this long with no turn (ms), as if the user
   * pressed New chat. Unset: chats only end on `newChat()` or `close()`.
   */
  chatIdleMs?: number;
  /**
   * Jett's eyes (src/screen/eyes.ts). Set: the `look` tool can see the screen, typed turns
   * carry the front app and window as text, and `screenRelease` sends circles. Unset: no screen.
   */
  eyes?: Eyes;
  /** Least gap between a circled crop and its label (ms, src/screen/service.ts). Tests set 0. */
  screenFrameGapMs?: number;
}

/** What `onAudio` hears: a chunk of the model's voice, or "drop what you queued" (interrupted). */
export type AudioOut = { type: "audio"; data: Int16Array; sampleRate: number } | { type: "clear" };

export interface AgentSession {
  /** Send one text turn. Resolves with every event of that turn, ending with `turn.done`. */
  sendText(text: string): Promise<AgentEvent[]>;
  /** Stream a chunk of the user's microphone (16-bit mono PCM, 16 kHz for Gemini). */
  sendAudio(data: Int16Array, sampleRate: number): void;
  /** Listen to the model's voice. Play `audio` in order; on `clear`, stop and drop anything queued. */
  onAudio(listener: (out: AudioOut) => void): () => void;
  /** Listen to every event on the stream. Returns a function that stops listening. */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /**
   * The orchestrator: submit any job (e.g. a tidy job), cancel one by id (the
   * job board's cancel button), list them. State changes arrive as `job.state` events.
   */
  jobs: Pick<Jobs, "submit" | "cancel" | "list">;
  /**
   * The window's approve / deny card (ticket 28): answer one call the gate asked
   * about, by its id. Yes: a `safety.verdict` allow, then it runs. No: a
   * `tool.result` declined, and the model says so. Returns false (and does
   * nothing) if no call with that id is waiting, e.g. it was already answered.
   */
  answer(id: string, approve: boolean): boolean;
  /** The brain folder in use now (absolute) and its part folder names (the window's file tree, ticket 23). */
  brain(): { root: string; folders: BrainFolders };
  /** The safety mode the gate uses right now. */
  mode(): SafetyMode;
  /**
   * Switch the safety mode (the window's dropdown). The very next tool call is
   * gated with it, and a `mode.changed` event goes on the stream.
   */
  setMode(mode: SafetyMode): void;
  /**
   * Pause: stop Jett's voice now (a `clear` on `onAudio`), drop its voice and the
   * mic until resumed, keep the chat. Emits `paused`. Typed turns still work.
   */
  setPaused(on: boolean): void;
  paused(): boolean;
  /**
   * Esc (ticket 37): stop the reply being spoken, like talking over it. Its voice
   * stops now (a `clear`), the rest of it is dropped, and `interrupted` goes on the
   * stream. The call and the mic stay on.
   */
  stopReply(): void;
  /** No network (ticket 40): try to reach the model now instead of after the backoff (the window's Retry). */
  reconnectNow(): void;
  /**
   * Screen awareness. `release`: Ctrl+Option was let go; a closed loop in `stroke` sends the
   * circled crop, and the turn gets the front app and cursor as text. Undefined without eyes.
   */
  screen?: Pick<Screen, "circle" | "release" | "permission" | "requestPermission">;
  /** Shift+Tab: Ask me -> Auto edits -> Bypass -> Ask me. Returns the new mode. */
  cycleMode(): SafetyMode;
  /** The setup wizard (the window's click-through setup). */
  setup: {
    /** True when there is no config file yet: this is the first launch. */
    needed(): boolean;
    /**
     * Use a config the wizard just saved, now: brain, folders, mode and helpers
     * at once, and a fresh model connection so the new voice and tone are heard
     * (unless a turn is in progress: then they apply from the next chat).
     * Emits `setup.saved` (after `mode.changed` if the mode changed).
     */
    apply(config: Config): Promise<void>;
  };
  /**
   * End this chat and start the next one in the same session (the window's
   * New chat button, or `chatIdleMs` of quiet). Writes the chat-end note,
   * queues the tidy job (it shows on the job board), then reconnects the
   * model so the next chat starts fresh, and emits `chat.started`. Helper
   * jobs keep running. Rejects while a turn is in progress.
   */
  newChat(): Promise<void>;
  /**
   * Stops running jobs, writes the chat-end note, then closes the model connection.
   * With `tidy` set, it then queues a tidy job and returns without waiting for it:
   * its `job.state` events keep arriving on this stream after close.
   */
  close(): Promise<void>;
}

export async function startSession(options: SessionOptions): Promise<AgentSession> {
  // ---- settings -----------------------------------------------------------
  // `let`: the setup wizard can save new answers, and they apply at once (applyConfig).
  let config = options.config ?? defaultConfig();
  // `let`: the window can switch it while the app runs (setMode); the gate reads it per call.
  let mode = options.mode ?? config.safety.mode;
  const overrides = options.overrides ?? config.safety.overrides;
  let brainPath = brainRoot(config.brainPath);
  const workDir = options.workDir ?? process.cwd();
  const configPath = options.configPath ?? defaultConfigPath();
  const summaryTimeoutMs = options.summaryTimeoutMs ?? 8000;
  const tools = options.tools ?? (await loadTools(options.toolsDir));

  // ---- the event stream ---------------------------------------------------
  const listeners = new Set<(event: AgentEvent) => void>();
  const audioListeners = new Set<(out: AudioOut) => void>();
  // Every event goes through here, so listeners and the current turn always
  // see exactly the same stream.
  function emit(event: AgentEvent) {
    turn?.events.push(event);
    for (const listener of listeners) listener(event);
  }
  function playAudio(out: AudioOut) {
    for (const listener of audioListeners) listener(out);
  }

  // ---- session state ------------------------------------------------------
  // The turn in flight (src/core/turn.ts): only one at a time.
  let turn: Turn | null = null;
  // What was said in this chat, for the chat-end note (src/core/chat-end.ts).
  const chat: ChatLine[] = [];
  // Set while the model writes the chat summary: its events go there, not to the chat.
  let summary: SummaryCollector | null = null;
  // Set while newChat() saves the old chat and reconnects: no turn may start then.
  let switching = false;
  // Set when close() begins: job ends are no longer announced and late model events are dropped.
  let closed = false;
  // The window's Pause: no voice out, no mic in, same chat.
  let paused = false;
  /** No network (ticket 40): the model is out of reach until a `connected`. Typed turns end at once. */
  let offline = false;
  /** Esc stopped the reply (ticket 37): drop its voice until the user speaks or the turn ends. */
  let silenced = false;

  // ---- jobs and tool calls -------------------------------------------------
  const jobs = createJobs({
    maxAtOnce: config.helpers.maxAtOnce,
    onState(job) {
      emit({ type: "job.state", ...job });
      toolCalls.onJobState(job);
    },
  });
  // The sketch canvas's marks (tickets 31, 33). A new chat starts a clean board.
  const canvas = createBoard(emit);
  // Jett's eyes (src/screen). `lastVoiceAt`: when the mic last carried a voice (or a
  // transcript came in), so a Ctrl+Option hold with no voice and no circle sends nothing.
  let lastVoiceAt = 0;
  const screen: Screen | undefined = options.eyes
    ? createScreen({
        eyes: options.eyes,
        emit,
        sendImage: (data, mimeType) => modelSession.sendImage?.(data, mimeType),
        sendText: (text) => modelSession.sendText(text),
        spokeSince: (since) => lastVoiceAt >= since,
        frameGapMs: options.screenFrameGapMs,
      })
    : undefined;
  const toolCalls = createToolCalls({
    tools,
    jobs,
    emit,
    send: (response) => modelSession.sendToolResponse(response),
    turn: () => turn,
    turnMayEnd: finishTurnIfOver,
    gate: () => ({ mode, overrides }),
    context: () => ({
      workDir,
      brainPath,
      brainFolders: config.brainFolders,
      helpers: {
        ...options.helpers,
        geminiCli: config.helpers.geminiCli,
        codex: config.helpers.codex,
        claudeCode: config.helpers.claudeCode,
        worktrees: config.worktrees,
      },
      screen: screen && { look: () => screen.look() },
    }),
    closing: () => closed,
    canvas,
  });
  const { approvals } = toolCalls;

  // ---- settings that change while running ---------------------------------
  function setMode(next: SafetyMode) {
    mode = next;
    emit({ type: "mode.changed", mode });
  }

  // Use what the setup wizard just saved, now. Brain, folders and helper on/off
  // are read per call, mode and max-at-once switch live, so no restart is needed.
  // Voice and tone are set per connection: setup.apply reconnects for them.
  function applyConfig(next: Config) {
    config = next;
    brainPath = brainRoot(next.brainPath);
    jobs.setMaxAtOnce(next.helpers.maxAtOnce);
    if (next.safety.mode !== mode) setMode(next.safety.mode);
  }

  // ---- turns --------------------------------------------------------------
  // Why one check: a new turn and a new chat both need the model to themselves.
  function busy(): Error | null {
    if (turn) return new Error("a turn is already in progress");
    if (switching) return new Error("a new chat is starting");
    return null;
  }

  // Every turn starts here: the calls waiting for a yes now wait for this turn's words.
  function startTurn(done?: (events: AgentEvent[]) => void): Turn {
    clearTimeout(idleTimer);
    turn = newTurn(done);
    approvals.openTurn();
    return turn;
  }

  function finishTurnIfOver() {
    if (!turn || !turnIsOver(turn)) return;
    const finished = turn;
    const heard = finished.heard.trim();
    // A spoken turn that was not a yes declines what waited (a typed one already did).
    approvals.closeTurn(heard !== "");
    // Why once, at the end: the app shows "notes used" next to the finished answer.
    if (finished.notes.size) emit({ type: "notes.used", notes: [...finished.notes] });
    canvas.turnDone();
    emit({ type: "turn.done", reply: finished.reply });
    turn = null;
    if (heard) chat.push({ role: "user", text: heard });
    if (finished.reply.trim()) chat.push({ role: "model", text: finished.reply.trim() });
    finished.done(finished.events);
    armIdleTimer();
  }

  // A spoken turn has no sendText to open it, so the model's first word about
  // it does. It waits for one `turn.complete`, like a text turn. Nobody awaits
  // its promise; listeners see its events on the stream.
  function openVoiceTurn(): Turn {
    if (turn) return turn;
    const voice = startTurn();
    voice.awaiting = 1;
    return voice;
  }

  // The quiet-spell timer (`chatIdleMs`): armed after each turn of a chat, so a
  // chat nobody has touched for a while ends by itself and leaves its note.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function armIdleTimer() {
    clearTimeout(idleTimer);
    if (!options.chatIdleMs || closed || !chat.length) return;
    idleTimer = setTimeout(() => void newChat().catch(() => {}), options.chatIdleMs);
    idleTimer.unref?.();
  }

  // ---- what the model says -> what the app sees ---------------------------
  function onModelEvent(event: ModelEvent) {
    // While the model writes the chat summary, its answer is the core's, not the chat's.
    if (!turn && summary) return summary.take(event);
    // Once close() has begun, the chat is over: late model events open no new turn.
    if (closed) return;
    switch (event.type) {
      case "user.text": {
        silenced = false;
        const voice = openVoiceTurn();
        voice.heard += event.text;
        lastVoiceAt = Date.now();
        emit({ type: "transcript", role: "user", text: event.text });
        // A spoken yes approves like a typed one. Why at the first match (not at
        // turn end): "yes" leads the sentence, and the model is already replying.
        approvals.hear(voice.heard);
        break;
      }
      case "audio":
        if (paused || silenced) break; // the rest of a sentence that was paused or stopped: never played
        openVoiceTurn();
        playAudio(event);
        break;
      case "interrupted":
        // Drop the queued voice first: the user is already talking.
        playAudio({ type: "clear" });
        emit({ type: "interrupted" });
        canvas.interrupted();
        break;
      case "text":
        { const t = openVoiceTurn(); t.reply = joinText(t.reply, event.text); }
        emit({ type: "transcript", role: "model", text: event.text });
        canvas.heard(event.text);
        break;
      case "tool.call":
        toolCalls.onCall(event);
        break;
      case "tool.cancel":
        toolCalls.onCancel(event.ids);
        break;
      case "generation.complete":
        // Chat turns wait for turn.complete: the user is still hearing the reply.
        break;
      case "turn.complete":
        silenced = false;
        if (!turn) return;
        turn.awaiting--;
        finishTurnIfOver();
        break;
      case "error":
        emit({ type: "error", message: event.message });
        break;
      case "reconnecting":
        offline = true;
        emit({ type: "connection", state: "reconnecting", attempt: event.attempt, retryInMs: event.retryInMs, message: event.message });
        // Same as a drop for the turn in flight: nothing more will come for it.
        toolCalls.forgetConnection("the connection to the model dropped");
        if (turn) turn.awaiting = turn.running = 0;
        finishTurnIfOver();
        break;
      case "connected":
        offline = false;
        emit({ type: "connection", state: "connected" });
        break;
      case "disconnected":
        // Whatever the model owed us will never come. End the turn now (a tool
        // still running finishes on its own) so nothing waits forever.
        emit({ type: "error", message: event.message });
        toolCalls.forgetConnection("the connection to the model dropped");
        if (turn) turn.awaiting = turn.running = 0;
        finishTurnIfOver();
        break;
    }
  }

  // ---- the model connection -----------------------------------------------
  // Each connection gets a number; events from an older one (still in flight
  // after a new chat reconnected) are dropped.
  let connection = 0;
  function connectModel() {
    const mine = ++connection;
    offline = false; // a fresh connection says `reconnecting` again if the network is still down
    return options.model.connect((event) => mine === connection && onModelEvent(event), {
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      voice: config.voice,
      systemInstruction: systemInstruction(config.tone, { brainPath }),
    });
  }
  let modelSession = await connectModel();

  // ---- ending a chat ------------------------------------------------------
  // Ask the model for the summary. A turn still in flight means the model is
  // busy: skip straight to the transcript.
  async function askForSummary(): Promise<string> {
    if (turn) return "";
    const collector = summaryCollector(summaryTimeoutMs);
    summary = collector;
    try {
      modelSession.sendText(SUMMARY_REQUEST);
    } catch {
      collector.take({ type: "error", message: "could not ask for a summary" });
    }
    try {
      return await collector.result;
    } finally {
      summary = null;
    }
  }

  // Write the chat-end note and forget the chat. Returns the note's path, or
  // null when nothing was said. Never throws: a note that cannot be written
  // is an error event, not a reason to stop.
  async function endChat(): Promise<string | null> {
    clearTimeout(idleTimer);
    try {
      if (!chat.length || options.chatEndNote === false) return null;
      const path = await saveChatNote(brainPath, chat, await askForSummary(), config.brainFolders);
      emit({ type: "brain.write", path, cause: "chat-end" });
      return path;
    } catch (err) {
      emit({ type: "error", message: `could not save the chat note: ${errorMessage(err)}` });
      return null;
    } finally {
      chat.length = 0;
    }
  }

  // Ticket 07: a chat that left a note gets tidied into wiki pages, as a job on the board.
  function queueTidy(notePath: string | null) {
    if (notePath && options.tidy) jobs.submit(tidyJob(brainPath, options.tidy, config.brainFolders));
  }

  async function newChat() {
    const error = busy();
    if (error) throw error;
    switching = true;
    try {
      const notePath = await endChat();
      toolCalls.forgetConnection("a new chat started");
      await modelSession.close();
      modelSession = await connectModel();
      queueTidy(notePath);
      canvas.clear();
      emit({ type: "chat.started" });
    } finally {
      switching = false;
    }
  }

  // ---- the session --------------------------------------------------------
  return {
    sendText(text) {
      const error = busy();
      if (error) return Promise.reject(error);
      return new Promise((done) => {
        const typed = startTurn(done);
        emit({ type: "transcript", role: "user", text });
        chat.push({ role: "user", text });
        // A yes runs what was waiting. The tools' answers tell the model it was
        // approved, so the "yes" text itself is not sent.
        if (approvals.hear(text)) return;
        approvals.closeTurn(true);
        if (offline) {
          // Ticket 40: say why at once instead of waiting on a model nobody can reach.
          emit({ type: "error", message: "No network: Jett is reconnecting to Gemini. Try again in a moment." });
          return finishTurnIfOver();
        }
        typed.awaiting++;
        if (!screen) return modelSession.sendText(text);
        // Screen awareness: the typed words go in with the front app and window as context.
        // Capped, so a slow lookup never holds a turn up.
        const note = Promise.race([screen.note().catch(() => ""), Bun.sleep(1000).then(() => "")]);
        void note.then((line) => modelSession.sendText(line ? `${line}\n${text}` : text));
      });
    },
    sendAudio(data, sampleRate) {
      if (paused) return;
      if (screen && isVoice(data)) lastVoiceAt = Date.now();
      modelSession.sendAudio(data, sampleRate);
    },
    setPaused(on) {
      if (on === paused) return;
      paused = on;
      if (on) playAudio({ type: "clear" });
      emit({ type: "paused", paused: on });
    },
    paused: () => paused,
    reconnectNow() {
      modelSession.retryNow?.();
    },
    screen: screen && {
      circle: (stroke: Pt[]) => screen.circle(stroke),
      release: (input: ReleaseInput) => screen.release(input),
      permission: () => screen.permission(),
      requestPermission: () => screen.requestPermission(),
    },
    stopReply() {
      silenced = true;
      playAudio({ type: "clear" });
      emit({ type: "interrupted" });
      canvas.interrupted();
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAudio(listener) {
      audioListeners.add(listener);
      return () => audioListeners.delete(listener);
    },
    jobs: { submit: jobs.submit, cancel: jobs.cancel, list: jobs.list },
    answer: (id, approve) => !closed && approvals.answer(id, approve),
    brain: () => ({ root: brainPath, folders: config.brainFolders }),
    mode: () => mode,
    setMode,
    cycleMode() {
      setMode(nextMode(mode));
      return mode;
    },
    setup: {
      needed: () => !existsSync(configPath),
      async apply(saved) {
        applyConfig(saved);
        emit({ type: "setup.saved", configPath, config: saved });
        // A fresh connection, so the next words use the new voice and tone.
        if (!busy() && !closed) await newChat();
      },
    },
    newChat,
    // Stops running jobs and writes the chat-end note side by side, so close
    // stays prompt. `closed` first: a job ending now is not announced to the
    // model, which is busy writing the chat summary.
    //
    // The tidy job is queued only after stopAll has finished, so close never
    // cancels it: it runs on with no model session (the tidy model is its own
    // call) and a failure is just a "failed" job, never an error for the next chat.
    async close() {
      closed = true;
      let notePath: string | null = null;
      try {
        [, notePath] = await Promise.all([jobs.stopAll(), endChat()]);
      } finally {
        await modelSession.close();
      }
      queueTidy(notePath);
    },
  };
}
