// The orchestrator: background jobs with states, a max-at-once limit and cancel.
//
//   const jobs = createJobs({ maxAtOnce: 1, onState: (job) => emit(...) });
//   const id = jobs.submit({ kind: "gemini-cli", title: "fix the bug", run: async ({ signal }) => "Fixed it." });
//   jobs.cancel(id);       // queued: dropped at once; running: aborted, cancelled once it has stopped
//   jobs.list();           // every job so far, oldest first
//   await jobs.stopAll();  // on shutdown
//
// Why a plain runner function: the orchestrator does not care what a job is.
// A Gemini CLI helper (src/helpers/gemini-cli.ts), a brain tidy job (ticket 07)
// or anything else is just `run({ signal }) -> summary`, and all of them show
// the same states on the job board.

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

/** A job as the app sees it. Plain JSON. */
export interface JobInfo {
  id: string;
  /** What kind of job, e.g. "gemini-cli" or "tidy". */
  kind: string;
  /** One short line for the job board. */
  title: string;
  state: JobState;
  /** done: the job's summary; failed: what went wrong and how to fix it. */
  message?: string;
}

export interface JobRun {
  /** Aborted when the job is cancelled. The runner must stop and settle soon after. */
  signal: AbortSignal;
}

export interface JobSpec {
  kind: string;
  title: string;
  /** Do the work. Resolve with a short summary; throw to fail (the error message is shown). */
  run(job: JobRun): Promise<string>;
}

export interface Jobs {
  /** Queue a job. Returns its id at once; the job starts when a slot is free. */
  submit(spec: JobSpec): string;
  /** Cancel a queued or running job. False if there is no such job or it already ended. */
  cancel(id: string): boolean;
  list(): JobInfo[];
  /** Cancel everything and wait until running jobs have stopped. */
  stopAll(): Promise<void>;
  /** Change how many jobs may run at once (the setup chat). Queued jobs start if there is room now. */
  setMaxAtOnce(max: number): void;
}

export interface JobsOptions {
  /** How many jobs may run at once (config `helpers.maxAtOnce`). */
  maxAtOnce: number;
  /** Called on every state change, in order, with a copy of the job. */
  onState(job: JobInfo): void;
}

export function createJobs({ maxAtOnce, onState }: JobsOptions): Jobs {
  // `maxAtOnce` is reassigned by setMaxAtOnce (the setup chat can change it live).
  type Entry = { info: JobInfo; spec: JobSpec; abort: AbortController; settled?: Promise<void> };
  const all = new Map<string, Entry>();
  const queue: Entry[] = [];
  let running = 0;
  let nextId = 1;

  function set(entry: Entry, state: JobState, message?: string) {
    entry.info.state = state;
    if (message !== undefined) entry.info.message = message;
    onState({ ...entry.info });
  }

  function pump() {
    while (running < maxAtOnce && queue.length) start(queue.shift()!);
  }

  function start(entry: Entry) {
    running++;
    set(entry, "running");
    const { signal } = entry.abort;
    entry.settled = Promise.resolve()
      .then(() => entry.spec.run({ signal }))
      .then(
        (summary) => (signal.aborted ? set(entry, "cancelled") : set(entry, "done", summary)),
        (err: unknown) =>
          signal.aborted ? set(entry, "cancelled") : set(entry, "failed", err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        running--;
        pump();
      });
  }

  return {
    submit(spec) {
      const entry: Entry = {
        info: { id: `job-${nextId++}`, kind: spec.kind, title: spec.title, state: "queued" },
        spec,
        abort: new AbortController(),
      };
      all.set(entry.info.id, entry);
      queue.push(entry);
      set(entry, "queued");
      pump();
      return entry.info.id;
    },
    cancel(id) {
      const entry = all.get(id);
      if (!entry) return false;
      if (entry.info.state === "queued") {
        queue.splice(queue.indexOf(entry), 1);
        entry.abort.abort();
        set(entry, "cancelled");
        return true;
      }
      if (entry.info.state === "running" && !entry.abort.signal.aborted) {
        // Why not "cancelled" right away: the job board should only say
        // cancelled once the work has really stopped.
        entry.abort.abort();
        return true;
      }
      return false;
    },
    list: () => [...all.values()].map((e) => ({ ...e.info })),
    setMaxAtOnce(max) {
      maxAtOnce = max;
      pump();
    },
    async stopAll() {
      for (const entry of [...queue]) this.cancel(entry.info.id);
      const settling = [...all.values()].filter((e) => e.info.state === "running").map((e) => e.settled);
      for (const entry of all.values()) entry.abort.abort();
      await Promise.all(settling);
    },
  };
}
