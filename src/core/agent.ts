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
import { brainRoot, saveRawNote } from "../brain/index.ts";
import { defaultConfig, type Config } from "../config/index.ts";
import type { AgentEvent, EventOf } from "./events.ts";
import type { Model, ModelEvent, ToolResponse } from "./model.ts";
import { loadTools } from "./registry.ts";
import { decide, explain, type SafetyMode, type SafetyOverrides } from "./safety.ts";
import type { Tool } from "./tool.ts";

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
  close(): Promise<void>;
}

type ToolCall = Extract<ModelEvent, { type: "tool.call" }>;

// What counts as "yes" when a tool call waits for approval. Anything else declines.
const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|approved?)\b/i;

// What close() asks the model for the chat-end note.
const SUMMARY_REQUEST =
  "The chat is ending now. Do not call any tools. Summarise this chat for my notes in two to five short " +
  "bullet points: what was said and what was decided. Reply with the bullet points only.";

export async function startSession(options: SessionOptions): Promise<AgentSession> {
  const config = options.config ?? defaultConfig();
  const mode = options.mode ?? config.safety.mode;
  const overrides = options.overrides ?? config.safety.overrides;
  const workDir = options.workDir ?? process.cwd();
  const brainPath = brainRoot(config.brainPath);
  const tools = options.tools ?? (await loadTools(options.toolsDir));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listeners = new Set<(event: AgentEvent) => void>();
  const audioListeners = new Set<(out: AudioOut) => void>();

  // The turn in flight. Why only one: a live conversation takes turns, so the core does too.
  // A turn ends when the model has answered everything we sent it (`awaiting`)
  // and no tool is still running (`running`). Tools are NON_BLOCKING, so the
  // model may finish speaking ("let me look...") before a tool's answer lands.
  let turn: {
    events: AgentEvent[];
    reply: string;
    awaiting: number;
    running: number;
    notes: Set<string>;
    /** What the user said in a voice turn (its transcription arrives in pieces). */
    heard: string;
    done: (events: AgentEvent[]) => void;
  } | null = null;

  // Calls the gate said "ask" about, waiting for the user's next turn.
  let waiting: ToolCall[] = [];

  // What was said, for the chat-end note: user texts and the model's joined replies.
  const chat: { role: "user" | "model"; text: string }[] = [];
  // Set while close() waits for the model's chat summary.
  let summary: { take(event: ModelEvent): void } | null = null;
  // After close(), late model events are dropped.
  let ended = false;
  const summaryTimeoutMs = options.summaryTimeoutMs ?? 8000;

  // Every event goes through here, so listeners and the current turn always
  // see exactly the same stream.
  function emit(event: AgentEvent) {
    turn?.events.push(event);
    for (const listener of listeners) listener(event);
  }

  function finishTurnIfIdle() {
    if (!turn || turn.awaiting > 0 || turn.running > 0) return;
    const finished = turn;
    // Why once, at the end: the app shows "notes used" next to the finished answer.
    if (finished.notes.size) emit({ type: "notes.used", notes: [...finished.notes] });
    emit({ type: "turn.done", reply: finished.reply });
    turn = null;
    if (finished.heard.trim()) chat.push({ role: "user", text: finished.heard.trim() });
    if (finished.reply.trim()) chat.push({ role: "model", text: finished.reply.trim() });
    finished.done(finished.events);
  }

  // Tell the model about a call, and put the same thing on the stream.
  function respond(
    call: ToolCall,
    status: EventOf<"tool.result">["status"],
    response: ToolResponse["response"],
    extra: Pick<ToolResponse, "scheduling" | "willContinue"> = {},
  ) {
    emit({
      type: "tool.result", id: call.id, name: call.name, status,
      ...("output" in response ? { output: response.output } : {}),
      ...(typeof response.error === "string" ? { error: response.error } : {}),
    });
    // A non-silent answer makes the model speak again, so the turn waits for it.
    if (extra.scheduling !== "silent" && turn) turn.awaiting++;
    modelSession.sendToolResponse({ id: call.id, name: call.name, response, ...extra });
  }

  function useNotes(paths: string[]) {
    for (const path of paths) turn?.notes.add(path);
  }

  // Why right away (not at turn end): "remember this" should show as saved the moment it is.
  function brainWrote(path: string, tool: string) {
    emit({ type: "brain.write", path, cause: "tool", tool });
  }

  // Ask the live model for a short summary of the chat, off the record (no
  // transcript events). Resolves "" if the model errors, calls a tool, or
  // takes longer than `summaryTimeoutMs`: the caller then falls back to the
  // plain transcript, so close() never hangs on an unreachable model.
  function askForSummary(): Promise<string> {
    return new Promise((resolve) => {
      let text = "";
      const finish = (result: string) => {
        clearTimeout(timer);
        summary = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish(""), summaryTimeoutMs);
      summary = {
        take(event) {
          if (event.type === "text") text += event.text;
          else if (event.type === "turn.complete") finish(text);
          else finish(""); // an error, or a tool call we will not run while closing
        },
      };
      try {
        modelSession.sendText(SUMMARY_REQUEST);
      } catch {
        finish("");
      }
    });
  }

  // The one raw note a chat leaves behind. Returns its path, or null when
  // nothing was said. Not a tool call, so the safety gate is not asked: the
  // spec saves this note after every chat, in every mode, and it only ever
  // adds a new file to raw/. Ticket 07 queues the tidy job on its brain.write.
  async function saveChatEndNote(): Promise<string | null> {
    if (!chat.length) return null;
    // A turn still in flight means the model is busy: skip straight to the transcript.
    const summarised = turn ? "" : (await askForSummary()).trim();
    const text = summarised || chat.map((line) => `- ${line.role === "user" ? "You" : "Agent"}: ${line.text}`).join("\n");
    const path = await saveRawNote(brainPath, { title: "Chat", text });
    emit({ type: "brain.write", path, cause: "chat-end" });
    return path;
  }

  function run(call: ToolCall, tool: Tool) {
    if (turn) turn.running++;
    // Why a promise chain (not await): the tool runs on its own while the
    // conversation goes on. Its answer goes back whenever it is ready.
    Promise.resolve()
      .then(() => tool.run(call.args, { workDir, brainPath, useNotes, brainWrote: (path) => brainWrote(path, call.name) }))
      .then(
        (output) => respond(call, "ok", { output: output ?? null }),
        (err: unknown) => respond(call, "error", { error: err instanceof Error ? err.message : String(err) }),
      )
      .finally(() => {
        if (turn) turn.running--;
        finishTurnIfIdle();
      });
  }

  // The door every tool call goes through. Nothing runs without a verdict.
  function onToolCall(call: ToolCall) {
    const tool = byName.get(call.name);
    emit({ type: "tool.call", id: call.id, name: call.name, args: call.args, risk: tool?.risk });

    if (!tool) {
      const reason = `there is no tool named ${call.name}`;
      emit({ type: "safety.verdict", id: call.id, name: call.name, mode, verdict: "block", reason });
      respond(call, "blocked", { status: "blocked", reason, instruction: "Tell the user briefly that you cannot do that." });
      return;
    }

    const input = { tool: call.name, args: call.args, risk: tool.risk, mode, overrides };
    const verdict = decide(input);
    const reason = explain(input, verdict);
    emit({ type: "safety.verdict", id: call.id, name: call.name, risk: tool.risk, mode, verdict, reason });

    switch (verdict) {
      case "allow":
        run(call, tool);
        break;
      case "block":
        // Like live-dj: the tool is skipped and the model gets the reason, so
        // it explains the refusal in its own voice.
        respond(call, "blocked", {
          status: "blocked",
          reason,
          instruction: `Do not retry. Tell the user in one short spoken sentence that you did not run ${call.name}, and why.`,
        });
        break;
      case "ask":
        waiting.push(call);
        // willContinue: the real answer for this call comes later, after the user's turn.
        respond(
          call,
          "waiting",
          {
            status: "waiting_for_approval",
            reason,
            instruction: `Ask the user out loud for a yes before ${call.name} runs. Say what it will do. The result arrives after they answer.`,
          },
          { willContinue: true },
        );
        break;
    }
  }

  // A spoken turn has no sendText to open it, so the model's first word about
  // it does. It waits for one `turn.complete`, like a text turn. Nobody awaits
  // its promise; listeners see its events on the stream.
  function openVoiceTurn() {
    if (!turn) turn = { events: [], reply: "", awaiting: 1, running: 0, notes: new Set(), heard: "", done: () => {} };
  }

  function playAudio(out: AudioOut) {
    for (const listener of audioListeners) listener(out);
  }

  // Translate what the model says into what the app sees.
  function onModelEvent(event: ModelEvent) {
    // While close() asks for the chat summary, the model's answer is the core's, not the chat's.
    if (!turn && summary) return summary.take(event);
    if (ended) return;
    switch (event.type) {
      case "user.text":
        openVoiceTurn();
        turn!.heard += event.text;
        emit({ type: "transcript", role: "user", text: event.text });
        break;
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
        openVoiceTurn();
        turn!.reply += event.text;
        emit({ type: "transcript", role: "model", text: event.text });
        break;
      case "tool.call":
        onToolCall(event);
        break;
      case "turn.complete":
        if (!turn) return;
        turn.awaiting--;
        finishTurnIfIdle();
        break;
      case "error":
        emit({ type: "error", message: event.message });
        break;
    }
  }

  const modelSession = await options.model.connect(onModelEvent, {
    tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  });

  return {
    sendText(text) {
      if (turn) return Promise.reject(new Error("a turn is already in progress"));
      return new Promise((done) => {
        turn = { events: [], reply: "", awaiting: 0, running: 0, notes: new Set(), heard: "", done };
        emit({ type: "transcript", role: "user", text });
        chat.push({ role: "user", text });

        const pending = waiting;
        waiting = [];
        if (pending.length && YES.test(text)) {
          // A yes runs what was waiting. The tool's answer tells the model it
          // was approved, so we do not also send the "yes" text.
          for (const call of pending) {
            const tool = byName.get(call.name)!;
            emit({
              type: "safety.verdict", id: call.id, name: call.name, risk: tool.risk, mode,
              verdict: "allow", reason: "the user said yes",
            });
            run(call, tool);
          }
          return;
        }
        // Anything else declines. Silent: the model hears it with the user's words,
        // and answers both at once.
        for (const call of pending) respond(call, "declined", { status: "declined", reason: "the user did not say yes" }, { scheduling: "silent" });
        turn.awaiting++;
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
    async close() {
      try {
        await saveChatEndNote();
      } catch (err) {
        emit({ type: "error", message: `could not save the chat note: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        ended = true;
        await modelSession.close();
      }
    },
  };
}
