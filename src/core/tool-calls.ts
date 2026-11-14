// Tool calls: the door every call from the model goes through.
//
//   call -> tool.call event -> safety gate -> allow: run it
//                                          -> block: tell the model why
//                                          -> ask:   wait for the user's yes (approvals.ts)
//   ...the tool answers -> tool.result event -> answer to the model
//
// Nothing runs without a verdict, and everything that happens is an event, so
// the app and the tests see exactly what the model was told.
//
// Jobs: a tool can start background jobs (a helper). The job stays tied to the
// call that started it: each job end gives that call one more answer, so the
// model announces "your helper is done" by itself.
//
// Connections: the model can lose its connection (a drop, a new chat). The new
// connection never heard of older calls, so their late answers go on our
// stream but are not sent to the model (`live`).
import { errorMessage } from "../errors.ts";
import { createApprovals, type Approvals } from "./approvals.ts";
import type { AgentEvent, EventOf } from "./events.ts";
import type { JobInfo, Jobs } from "./jobs.ts";
import type { ToolResponse } from "./model.ts";
import { rule, type GateState, type SafetyMode, type SafetyOverrides } from "./safety.ts";
import type { Tool, ToolContext } from "./tool.ts";
import type { ToolCall, Turn } from "./turn.ts";

export interface ToolCallsDeps {
  tools: Tool[];
  jobs: Jobs;
  emit(event: AgentEvent): void;
  /** Send an answer to the model's current connection. */
  send(response: ToolResponse): void;
  /** The turn in flight (a running tool holds it open). */
  turn(): Turn | null;
  /** Called when a tool finished: the turn may be over now. */
  turnMayEnd(): void;
  /** What the gate needs right now: the mode, the config's overrides, the setup state. */
  gate(): { mode: SafetyMode; overrides: SafetyOverrides; state: GateState };
  /** The rest of what a running tool gets (folders, helper settings, setup). */
  context(): Pick<ToolContext, "workDir" | "brainPath" | "helpers" | "setup">;
  /** True once the session is closing: job ends are not announced any more. */
  closing(): boolean;
}

export interface ToolCalls {
  /** The model asked for a tool. */
  onCall(call: ToolCall): void;
  /** The model took these calls back (e.g. the user talked over it). */
  onCancel(ids: string[]): void;
  /** A job changed state (from the orchestrator's onState). */
  onJobState(job: JobInfo): void;
  /** The model is on a new connection: forget the calls of the old one. */
  forgetConnection(reason: string): void;
  /** Calls waiting for the user's yes. */
  approvals: Approvals;
}

export function createToolCalls(deps: ToolCallsDeps): ToolCalls {
  const byName = new Map(deps.tools.map((t) => [t.name, t]));
  // Calls made on the connection we have now.
  const live = new Map<string, ToolCall>();
  // Calls the model took back: their late answers are not shown or sent.
  const cancelled = new Set<string>();

  // A job tied to the call that started it. Why wait for `answered`: a job can
  // end before the tool's first answer has gone out, and the model must hear
  // "started" before "finished".
  type Watch = { call: ToolCall; open: number; answered: boolean; ended: JobInfo[] };
  const watchByJob = new Map<string, Watch>();

  const approvals = createApprovals({
    approve(calls) {
      for (const call of calls) {
        const tool = byName.get(call.name)!;
        const { mode } = deps.gate();
        deps.emit({
          type: "safety.verdict", id: call.id, name: call.name, risk: tool.risk, mode,
          verdict: "allow", reason: "the user said yes",
        });
        run(call, tool);
      }
    },
    // Silent: the model hears it together with the user's words, and answers both at once.
    decline(calls, reason) {
      for (const call of calls) respond(call, "declined", { status: "declined", reason }, { scheduling: "silent" });
    },
  });

  // Tell the model about a call, and put the same thing on the stream.
  function respond(
    call: ToolCall,
    status: EventOf<"tool.result">["status"],
    response: ToolResponse["response"],
    extra: Pick<ToolResponse, "scheduling" | "willContinue"> = {},
  ) {
    if (cancelled.has(call.id)) return;
    deps.emit({
      type: "tool.result", id: call.id, name: call.name, status,
      ...("output" in response ? { output: response.output } : {}),
      ...(typeof response.error === "string" ? { error: response.error } : {}),
    });
    if (!live.has(call.id)) return;
    // A non-silent answer makes the model speak again, so the turn waits for it.
    const turn = deps.turn();
    if (extra.scheduling !== "silent" && turn) turn.awaiting++;
    deps.send({ id: call.id, name: call.name, response, ...extra });
  }

  function announceEnded(watch: Watch) {
    for (const job of watch.ended.splice(0)) {
      watch.open--;
      if (deps.closing()) continue;
      respond(
        watch.call,
        "ok",
        { output: { jobId: job.id, state: job.state, message: job.message ?? null } },
        { willContinue: watch.open > 0 },
      );
    }
  }

  function run(call: ToolCall, tool: Tool) {
    // The turn this run holds open. Only a dropped connection ends it early.
    const owner = deps.turn();
    if (owner) owner.running++;
    const watch: Watch = { call, open: 0, answered: false, ended: [] };
    const context: ToolContext = {
      ...deps.context(),
      useNotes(paths) {
        for (const path of paths) deps.turn()?.notes.add(path);
      },
      // Why right away (not at turn end): "remember this" should show as saved the moment it is.
      brainWrote(path) {
        deps.emit({ type: "brain.write", path, cause: "tool", tool: call.name });
      },
      jobs: {
        submit(spec) {
          // A job never ends inside submit, so watching right after is safe.
          const id = deps.jobs.submit(spec);
          watch.open++;
          watchByJob.set(id, watch);
          return id;
        },
        cancel: deps.jobs.cancel,
        list: deps.jobs.list,
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
        (err: unknown) => respond(call, "error", { error: errorMessage(err) }),
      )
      .finally(() => {
        if (!owner || owner !== deps.turn()) return;
        owner.running--;
        deps.turnMayEnd();
      });
  }

  return {
    approvals,

    onCall(call) {
      live.set(call.id, call);
      const tool = byName.get(call.name);
      const { mode, overrides, state } = deps.gate();
      deps.emit({ type: "tool.call", id: call.id, name: call.name, args: call.args, risk: tool?.risk });

      if (!tool) {
        const reason = `there is no tool named ${call.name}`;
        deps.emit({ type: "safety.verdict", id: call.id, name: call.name, mode, verdict: "block", reason });
        respond(call, "blocked", { status: "blocked", reason, instruction: "Tell the user briefly that you cannot do that." });
        return;
      }

      const input = { tool: call.name, args: call.args, risk: tool.risk, mode, overrides };
      const { verdict, reason } = rule(input, tool.gate?.(state));
      deps.emit({ type: "safety.verdict", id: call.id, name: call.name, risk: tool.risk, mode, verdict, reason });

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
          approvals.ask(call);
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
    },

    // A call waiting for a yes stops waiting; a running tool cannot be stopped
    // mid-way, but its answer is dropped. Either way the stream shows
    // "cancelled" once, and the model hears nothing more about it.
    onCancel(ids) {
      for (const id of ids) {
        const call = live.get(id);
        if (!call) continue;
        approvals.drop(id);
        live.delete(id);
        cancelled.add(id);
        deps.emit({ type: "tool.result", id, name: call.name, status: "cancelled" });
      }
    },

    onJobState(job) {
      const watch = watchByJob.get(job.id);
      if (!watch || job.state === "queued" || job.state === "running") return;
      watchByJob.delete(job.id);
      watch.ended.push(job);
      if (watch.answered) announceEnded(watch);
    },

    forgetConnection(reason) {
      live.clear();
      for (const call of approvals.dropAll()) respond(call, "cancelled", { status: "cancelled", reason });
    },
  };
}
