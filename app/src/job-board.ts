// The job board, built from the core's `job.state` events. Pure, like transcript.ts:
// one row per job, in the order jobs started, showing the latest state in board words.
import type { AgentEvent } from "../../src/core/events.ts";
import type { JobState } from "../../src/core/jobs.ts";

export type JobStatus = "waiting" | "working" | "done" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  title: string;
  status: JobStatus;
  /** done: the summary; failed: what went wrong and how to fix it. */
  message?: string;
  /** Worktrees on: the git worktree and branch the helper works in. */
  worktree?: { path: string; branch: string };
  /** Only a waiting or working job has a cancel button. */
  cancellable: boolean;
}

export type JobBoard = JobRow[];

export const emptyBoard: JobBoard = [];

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
    ...(event.message ? { message: event.message } : {}),
    ...(event.worktree ? { worktree: event.worktree } : {}),
    cancellable: status === "waiting" || status === "working",
  };
  const at = board.findIndex((r) => r.id === event.id);
  return at < 0 ? [...board, row] : board.map((r, i) => (i === at ? row : r));
}

/** The mini orb's number: jobs working right now (waiting ones are not running yet). */
export function runningCount(board: JobBoard): number {
  return board.filter((r) => r.status === "working").length;
}
