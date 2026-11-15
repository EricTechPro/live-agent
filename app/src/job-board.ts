// The job board, built from the core's `job.state` events. Pure, like transcript.ts:
// one card per job, in the order jobs started, showing the latest state in board words.
// Ticket 29: each card reads on its own: short title, which helper, state, a ticking
// elapsed time, the folder, and when it ends a one-line summary that expands to the output.
import type { AgentEvent } from "../../src/core/events.ts";
import type { JobState } from "../../src/core/jobs.ts";

export type JobStatus = "waiting" | "working" | "done" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  title: string;
  status: JobStatus;
  /** The job's kind: a helper id ("claude-code", "codex", "gemini-cli") or "tidy". */
  helper: string;
  /** The helper's name people say: "Claude Code". */
  helperLabel: string;
  /** The folder the job works in (helper jobs). */
  folder?: string;
  startedAt?: number;
  endedAt?: number;
  /** done: the summary; failed: what went wrong and how to fix it. */
  message?: string;
  /** done or failed: one plain line for the card. */
  summary?: string;
  /** done or failed: the whole answer or error, shown when the card expands. */
  output?: string;
  /** Worktrees on: the git worktree and branch the helper works in. */
  worktree?: { path: string; branch: string };
  /** Only a waiting or working job has a cancel button. */
  cancellable: boolean;
}

export type JobBoard = JobRow[];

export const emptyBoard: JobBoard = [];

/** What each helper is called on its card. */
export const HELPER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  tidy: "Tidy",
};

const STATUS: Record<JobState, JobStatus> = {
  queued: "waiting",
  running: "working",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export function addJobEvent(board: JobBoard, event: AgentEvent): JobBoard {
  if (event.type !== "job.state") return board;
  const status = STATUS[event.state];
  const row: JobRow = {
    id: event.id,
    title: event.title,
    status,
    helper: event.kind,
    helperLabel: HELPER_LABELS[event.kind] ?? event.kind,
    ...(event.folder ? { folder: event.folder } : {}),
    ...(event.startedAt !== undefined ? { startedAt: event.startedAt } : {}),
    ...(event.endedAt !== undefined ? { endedAt: event.endedAt } : {}),
    ...(event.message ? { message: event.message } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.output ? { output: event.output } : {}),
    ...(event.worktree ? { worktree: event.worktree } : {}),
    cancellable: status === "waiting" || status === "working",
  };
  const at = board.findIndex((r) => r.id === event.id);
  return at < 0 ? [...board, row] : board.map((r, i) => (i === at ? row : r));
}

/** How long a job has run: "12s", "3m 05s", "1h 02m". Ticks with `now` until it ends; "" before it starts. */
export function elapsed(job: { startedAt?: number; endedAt?: number }, now: number): string {
  if (job.startedAt === undefined) return "";
  const s = Math.max(0, Math.floor(((job.endedAt ?? now) - job.startedAt) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
}

/** The mini orb's number: jobs working right now (waiting ones are not running yet). */
export function runningCount(board: JobBoard): number {
  return board.filter((r) => r.status === "working").length;
}
