// The agent core: the single entry point the app and the tests use.
//
//   const session = await startSession({ model });
//   session.onEvent((e) => ...);              // every event, as it happens
//   const events = await session.sendText("hi");  // or: just this turn's events
//   await session.close();
//
// Why this shape: voice comes later (ticket 08), but a text turn is the same
// conversation without a microphone, so every test can drive the real core
// through text alone (the same trick as live-dj's smoke_live).
import { brainRoot } from "../brain/index.ts";
import { defaultConfig, type Config } from "../config/index.ts";
import type { AgentEvent, EventOf } from "./events.ts";
import { createJobs, type JobInfo, type Jobs } from "./jobs.ts";
import type { Model, ModelEvent, ToolResponse } from "./model.ts";
import { loadTools } from "./registry.ts";
import { decide, explain, type SafetyMode, type SafetyOverrides } from "./safety.ts";
import type { Tool, ToolContext } from "./tool.ts";

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
  /** Where helper CLIs live (tests point these at fake scripts). */
  helpers?: { geminiCliBin?: string; geminiCliHome?: string; cancelGraceMs?: number };
}

export interface AgentSession {
  /** Send one text turn. Resolves with every event of that turn, ending with `turn.done`. */
  sendText(text: string): Promise<AgentEvent[]>;
  /** Listen to every event on the stream. Returns a function that stops listening. */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /**
   * The orchestrator: submit any job (e.g. a tidy job), cancel one by id (the
   * job board's cancel button), list them. State changes arrive as `job.state` events.
   */
  jobs: Pick<Jobs, "submit" | "cancel" | "list">;
  /** Stops running jobs, then closes the model connection. */
  close(): Promise<void>;
}

type ToolCall = Extract<ModelEvent, { type: "tool.call" }>;

// What counts as "yes" when a tool call waits for approval. Anything else declines.
const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|approved?)\b/i;

export async function startSession(options: SessionOptions): Promise<AgentSession> {
  const config = options.config ?? defaultConfig();
  const mode = options.mode ?? config.safety.mode;
  const overrides = options.overrides ?? config.safety.overrides;
  const workDir = options.workDir ?? process.cwd();
  const brainPath = brainRoot(config.brainPath);
  const tools = options.tools ?? (await loadTools(options.toolsDir));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listeners = new Set<(event: AgentEvent) => void>();
  let closed = false;

  // Jobs started by a tool call stay tied to it: each job end gives the call
  // one more answer, so the model announces the result.
  type Watch = { call: ToolCall; open: number; answered: boolean; ended: JobInfo[] };
  const watchByJob = new Map<string, Watch>();
  const jobs = createJobs({
    maxAtOnce: config.helpers.maxAtOnce,
    onState(job) {
      emit({ type: "job.state", ...job });
      const watch = watchByJob.get(job.id);
      if (!watch || job.state === "queued" || job.state === "running") return;
      watchByJob.delete(job.id);
      watch.ended.push(job);
      if (watch.answered) announceEnded(watch);
    },
  });

  // Why wait for `answered`: a job can end before the tool's first answer has
  // gone out, and the model must hear "started" before "finished".
  function announceEnded(watch: Watch) {
    for (const job of watch.ended.splice(0)) {
      watch.open--;
      if (closed) continue;
      respond(
        watch.call,
        "ok",
        { output: { jobId: job.id, state: job.state, message: job.message ?? null } },
        { willContinue: watch.open > 0 },
      );
    }
  }

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
    done: (events: AgentEvent[]) => void;
  } | null = null;

  // Calls the gate said "ask" about, waiting for the user's next turn.
  let waiting: ToolCall[] = [];

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

  function run(call: ToolCall, tool: Tool) {
    if (turn) turn.running++;
    const watch: Watch = { call, open: 0, answered: false, ended: [] };
    const context: ToolContext = {
      workDir,
      brainPath,
      useNotes,
      jobs: {
        submit(spec) {
          // A job never ends inside submit, so watching right after is safe.
          const id = jobs.submit(spec);
          watch.open++;
          watchByJob.set(id, watch);
          return id;
        },
        cancel: jobs.cancel,
        list: jobs.list,
      },
      helpers: {
        geminiCli: config.helpers.geminiCli,
        geminiCliBin: options.helpers?.geminiCliBin ?? "gemini",
        geminiCliHome: options.helpers?.geminiCliHome,
        cancelGraceMs: options.helpers?.cancelGraceMs,
      },
    };
    // Why a promise chain (not await): the tool runs on its own while the
    // conversation goes on. Its answer goes back whenever it is ready.
    Promise.resolve()
      .then(() => tool.run(call.args, context))
      .then(
        (output) => {
          // A call that started jobs gets more answers later, so this one says "more to come".
          respond(call, "ok", { output: output ?? null }, watch.open ? { willContinue: true } : {});
          watch.answered = true;
          announceEnded(watch);
        },
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

  // Translate what the model says into what the app sees.
  function onModelEvent(event: ModelEvent) {
    switch (event.type) {
      case "text":
        if (turn) turn.reply += event.text;
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
        turn = { events: [], reply: "", awaiting: 0, running: 0, notes: new Set(), done };
        emit({ type: "transcript", role: "user", text });

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
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    jobs: { submit: jobs.submit, cancel: jobs.cancel, list: jobs.list },
    async close() {
      closed = true;
      await jobs.stopAll();
      await modelSession.close();
    },
  };
}
