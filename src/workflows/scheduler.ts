// The scheduler: fires due workflows while Jett is open.
//
//   const scheduler = startScheduler({ home, submit: (wf) => jobs.submit(...) });
//   scheduler.stop();   // on close
//
// - Runs in the core process only: Jett closed, nothing runs.
// - Reads the workflow files on every tick, so a new, changed or deleted file counts at once.
// - Ticks twice a minute, so no minute is missed when the timer drifts; each
//   workflow fires at most once per matching minute.
// - Missed runs (Jett closed, Mac asleep) are skipped, never caught up.
// - Scheduled jobs run on their own: no approval card (Eric's call). `submit` goes
//   straight to the jobs runner, not through the safety gate.
import { cronMatches, parseCron } from "./cron.ts";
import { listWorkflows, type Workflow } from "./index.ts";

export interface SchedulerOptions {
  home: string;
  submit(wf: Workflow): void;
  /** Called once per new minute too (reminders, src/reminders.ts). */
  onMinute?(at: Date): void;
  /** Default 30 s. */
  tickMs?: number;
  now?: () => Date;
}

export function startScheduler({ home, submit, onMinute, tickMs = 30_000, now = () => new Date() }: SchedulerOptions) {
  let lastMinute = "";
  function tick() {
    const at = now();
    const minute = `${at.toDateString()} ${at.getHours()}:${at.getMinutes()}`;
    if (minute === lastMinute) return;
    lastMinute = minute;
    onMinute?.(at);
    for (const wf of listWorkflows(home)) {
      if (wf.error || wf.trigger === "manual" || !cronMatches(parseCron(wf.trigger), at)) continue;
      submit(wf);
    }
  }
  const timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error(`live-agent: scheduler: ${(err as Error).message}`);
    }
  }, tickMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
