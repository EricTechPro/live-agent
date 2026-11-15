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
import { brainRoot } from "../brain/index.ts";
import { tidyJob, type TidyModel } from "../brain/tidy.ts";
import { defaultConfig, defaultConfigPath, type Config } from "../config/index.ts";
import { errorMessage } from "../errors.ts";
import type { HelperPaths } from "../helpers/gemini-cli.ts";
import { currentConfig, setupKickoff } from "../setup/index.ts";
import { saveChatNote, SUMMARY_REQUEST, summaryCollector, type ChatLine, type SummaryCollector } from "./chat-end.ts";
import type { AgentEvent } from "./events.ts";
import { createJobs, type Jobs } from "./jobs.ts";
import type { Model, ModelEvent } from "./model.ts";
import { loadTools } from "./registry.ts";
import { nextMode, type SafetyMode, type SafetyOverrides } from "./safety.ts";
import type { Tool } from "./tool.ts";
import { createToolCalls } from "./tool-calls.ts";
import { newTurn, turnIsOver, type Turn } from "./turn.ts";

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
  /** The config file the setup chat reads and writes. Default: `defaultConfigPath()`. */
  configPath?: string;
  /** Save a chat-end note into the brain on `close()`. Default true; `live-agent setup` turns it off. */
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
  /** The safety mode the gate uses right now. */
  mode(): SafetyMode;
  /**
   * Switch the safety mode (the window's dropdown). The very next tool call is
   * gated with it, and a `mode.changed` event goes on the stream.
   */
  setMode(mode: SafetyMode): void;
  /** Shift+Tab: Ask me -> Auto edits -> Bypass -> Ask me. Returns the new mode. */
  cycleMode(): SafetyMode;
  /** The setup chat (ticket 12). */
  setup: {
    /** True when there is no config file yet: this is the first launch. */
    needed(): boolean;
    /**
     * Start a setup chat: the model greets and asks the setup questions, then
     * saves the answers with `save_setup`. Resolves with that first turn's
     * events, starting with `setup.started`. With `ifNeeded`, does nothing
     * (resolves []) when a config file already exists.
     */
    start(options?: { ifNeeded?: boolean }): Promise<AgentEvent[]>;
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
  // `let`: a setup chat can save new answers, and they apply at once (applyConfig).
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
  // True from setup.start() until save_setup has written the file: the only time save_setup may run.
  let setupActive = false;
  // Set while newChat() saves the old chat and reconnects: no turn may start then.
  let switching = false;
  // Set when close() begins: job ends are no longer announced and late model events are dropped.
  let closed = false;

  // ---- jobs and tool calls -------------------------------------------------
  const jobs = createJobs({
    maxAtOnce: config.helpers.maxAtOnce,
    onState(job) {
      emit({ type: "job.state", ...job });
      toolCalls.onJobState(job);
    },
  });
  const toolCalls = createToolCalls({
    tools,
    jobs,
    emit,
    send: (response) => modelSession.sendToolResponse(response),
    turn: () => turn,
    turnMayEnd: finishTurnIfOver,
    gate: () => ({ mode, overrides, state: { setupActive } }),
    context: () => ({
      workDir,
      brainPath,
      helpers: { ...options.helpers, geminiCli: config.helpers.geminiCli, worktrees: config.worktrees },
      setup: {
        configPath,
        saved(saved) {
          setupActive = false;
          applyConfig(saved);
          emit({ type: "setup.saved", configPath, config: saved });
        },
      },
    }),
    closing: () => closed,
  });
  const { approvals } = toolCalls;

  // ---- settings that change while running ---------------------------------
  function setMode(next: SafetyMode) {
    mode = next;
    emit({ type: "mode.changed", mode });
  }

  // Use what the setup chat just saved, now. Everything setup asks about is
  // read per call (brain, helper on/off) or can switch live (mode, max at once),
  // so no restart is needed. The voice is set per connection: it changes on the
  // next connection (a new chat or a restart).
  function applyConfig(next: Config) {
    config = next;
    brainPath = brainRoot(next.brainPath);
    jobs.setMaxAtOnce(next.helpers.maxAtOnce);
    if (next.safety.mode !== mode) setMode(next.safety.mode);
  }

  // ---- turns --------------------------------------------------------------
  // Why one check: a new turn, setup and a new chat all need the model to themselves.
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
        const voice = openVoiceTurn();
        voice.heard += event.text;
        emit({ type: "transcript", role: "user", text: event.text });
        // A spoken yes approves like a typed one. Why at the first match (not at
        // turn end): "yes" leads the sentence, and the model is already replying.
        approvals.hear(voice.heard);
        break;
      }
      case "audio":
        openVoiceTurn();
        playAudio(event);
        break;
      case "interrupted":
        // Drop the queued voice first: the user is already talking.
        playAudio({ type: "clear" });
        emit({ type: "interrupted" });
        break;
      case "text":
        openVoiceTurn().reply += event.text;
        emit({ type: "transcript", role: "model", text: event.text });
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
        if (!turn) return;
        turn.awaiting--;
        finishTurnIfOver();
        break;
      case "error":
        emit({ type: "error", message: event.message });
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
    return options.model.connect((event) => mine === connection && onModelEvent(event), {
      tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      voice: config.voice,
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
      const path = await saveChatNote(brainPath, chat, await askForSummary());
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
    if (notePath && options.tidy) jobs.submit(tidyJob(brainPath, options.tidy));
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
        typed.awaiting++;
        modelSession.sendText(text);
      });
    },
    sendAudio(data, sampleRate) {
      modelSession.sendAudio(data, sampleRate);
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
    mode: () => mode,
    setMode,
    cycleMode() {
      setMode(nextMode(mode));
      return mode;
    },
    setup: {
      needed: () => !existsSync(configPath),
      start({ ifNeeded = false } = {}) {
        const firstRun = !existsSync(configPath);
        if (ifNeeded && !firstRun) return Promise.resolve([]);
        const error = busy();
        if (error) return Promise.reject(error);
        let kickoff: string;
        try {
          kickoff = setupKickoff(currentConfig(configPath), firstRun);
        } catch (err) {
          return Promise.reject(err);
        }
        setupActive = true;
        return new Promise((done) => {
          const setup = startTurn(done);
          emit({ type: "setup.started", configPath, firstRun });
          // Like any new turn, it declines calls still waiting for a yes.
          approvals.closeTurn(true, "the user started setup");
          // The kickoff is the core speaking to the model, not the user: no
          // transcript line, and it stays out of the chat-end note.
          setup.awaiting++;
          modelSession.sendText(kickoff);
        });
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
