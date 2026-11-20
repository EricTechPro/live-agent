// Reminders ("nudge me in 3 hours to go to the gym"): a small JSON file in the brain folder.
//
//   const r = await addReminder(brain, { text: "Go to the gym", when: "in 3 hours" });
//   await dueReminders(brain, new Date());   // the ones to nudge about now (marked as fired)
//
// Why a JSON file (not notes): reminders change state (done, snoozed, fired), and the
// window lists them. `.reminders.json` sits at the brain's root like `.tidy-state.json`;
// dot files are never read as notes. Every reminder has one `due` time; a repeating
// one (`every`, a cron line) moves its `due` to the next match each time it fires.
// Fires only while Jett is open (the scheduler's tick, src/workflows/scheduler.ts).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cronMatches, parseCron } from "./workflows/cron.ts";

export interface Reminder {
  id: string;
  text: string;
  /** When it is due next (ISO). */
  due: string;
  /** Repeats on this cron line ("0 8 * * 1-5"). */
  every?: string;
  /** It nudged already (a one-shot stays listed until it is ticked). */
  fired?: boolean;
  done?: boolean;
  created: string;
}

export const REMINDERS_FILE = ".reminders.json";

const file = (brain: string) => join(brain, REMINDERS_FILE);

export async function loadReminders(brain: string): Promise<Reminder[]> {
  try {
    const parsed = JSON.parse(await readFile(file(brain), "utf8"));
    return Array.isArray(parsed) ? (parsed as Reminder[]) : [];
  } catch {
    return [];
  }
}

async function save(brain: string, list: Reminder[]): Promise<void> {
  await mkdir(dirname(file(brain)), { recursive: true });
  // Write then rename: a crash mid-write never leaves half a file.
  const tmp = `${file(brain)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
  await rename(tmp, file(brain));
}

/** The open ones (not done), soonest first. */
export async function openReminders(brain: string): Promise<Reminder[]> {
  return (await loadReminders(brain)).filter((r) => !r.done).sort((a, b) => a.due.localeCompare(b.due));
}

/** The next minute after `from` that a cron line matches (within 400 days). */
export function nextMatch(every: string, from: Date): Date {
  const cron = parseCron(every);
  const at = new Date(from);
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 400; i++, at.setMinutes(at.getMinutes() + 1)) if (cronMatches(cron, at)) return new Date(at);
  throw new Error(`"${every}" never comes round`);
}

const UNITS: Record<string, number> = { minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080 };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * A time in plain words, from `now` (local time): "in 3 hours", "in 20 min", "at 5pm",
 * "5:30 pm", "tomorrow at 9", "tonight at 8", "friday 10am", or an ISO time. A clock time
 * already past today means tomorrow. Throws a plain message for anything else.
 */
export function parseWhen(words: string, now: Date): Date {
  const w = words.trim().toLowerCase().replace(/\s+/g, " ");
  const iso = /^\d{4}-\d{2}-\d{2}/.test(w) ? new Date(words.trim()) : undefined;
  if (iso && !Number.isNaN(iso.getTime())) return iso;
  const rel = w.match(/^in (an?|\d+(?:\.\d+)?) ?(minute|min|hour|hr|day|week)s?$/);
  if (rel) {
    const n = rel[1] === "a" || rel[1] === "an" ? 1 : Number(rel[1]);
    return new Date(now.getTime() + n * UNITS[rel[2]!]! * 60_000);
  }
  const m = w.match(/^(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)?(?: at)? ?(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/);
  if (m && (m[1] || m[4] || m[3] !== undefined || /\bat\b/.test(w))) {
    let hour = Number(m[2]);
    const minute = m[3] ? Number(m[3]) : 0;
    if (hour > 23 || minute > 59 || (m[4] && (hour < 1 || hour > 12))) throw new Error(`"${words}" is not a time`);
    if (m[4] === "pm" && hour < 12) hour += 12;
    if (m[4] === "am" && hour === 12) hour = 0;
    // "tonight at 8" with no am/pm means 8 pm.
    if (m[1] === "tonight" && !m[4] && hour < 12) hour += 12;
    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    const day = m[1];
    if (day === "tomorrow") at.setDate(at.getDate() + 1);
    else if (day && DAYS.includes(day)) {
      const ahead = (DAYS.indexOf(day) - now.getDay() + 7) % 7;
      at.setDate(at.getDate() + ahead);
      if (at <= now) at.setDate(at.getDate() + 7);
    } else if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  throw new Error(`I can't read "${words}" as a time. Say it like "in 3 hours", "in 20 minutes", "at 5pm" or "tomorrow at 9am".`);
}

let counter = 0;
const newId = (now: Date) => `r${now.getTime().toString(36)}${(counter++ % 36).toString(36)}`;

export async function addReminder(
  brain: string,
  input: { text: string; when?: string; every?: string },
  now = new Date(),
): Promise<Reminder> {
  const text = input.text.trim();
  if (!text) throw new Error("say what to remind them about");
  if (!input.when?.trim() && !input.every?.trim()) throw new Error('give when ("in 3 hours", "at 5pm") or every (a cron line)');
  const every = input.every?.trim() || undefined;
  const due = input.when?.trim() ? parseWhen(input.when, now) : nextMatch(every!, now);
  if (every) parseCron(every);
  const reminder: Reminder = { id: newId(now), text, due: due.toISOString(), ...(every ? { every } : {}), created: now.toISOString() };
  const list = await loadReminders(brain);
  list.push(reminder);
  await save(brain, list);
  return reminder;
}

/** Find one open reminder by id, or by its words (a single best match). */
function pick(list: Reminder[], key: string): Reminder {
  const open = list.filter((r) => !r.done);
  const byId = open.find((r) => r.id === key);
  if (byId) return byId;
  const k = key.trim().toLowerCase();
  const hits = open.filter((r) => r.text.toLowerCase().includes(k) || k.includes(r.text.toLowerCase()));
  if (hits.length === 1) return hits[0]!;
  if (!hits.length) throw new Error(`no open reminder matches "${key}"`);
  throw new Error(`"${key}" matches ${hits.length} reminders: ${hits.map((r) => `${r.id} "${r.text}"`).join(", ")}. Use the id.`);
}

/** Tick one off. A repeating one is done for good too (snooze skips one go). */
export async function doneReminder(brain: string, key: string): Promise<Reminder> {
  const list = await loadReminders(brain);
  const r = pick(list, key);
  r.done = true;
  await save(brain, list);
  return r;
}

/** Push one back: `minutes` from now (default 10), or to `when` in plain words. */
export async function snoozeReminder(brain: string, key: string, by: { minutes?: number; when?: string }, now = new Date()): Promise<Reminder> {
  const list = await loadReminders(brain);
  const r = pick(list, key);
  const due = by.when?.trim() ? parseWhen(by.when, now) : new Date(now.getTime() + Math.max(1, by.minutes ?? 10) * 60_000);
  r.due = due.toISOString();
  r.fired = false;
  await save(brain, list);
  return r;
}

/**
 * The reminders due by `now` that have not nudged yet. They are marked at once, so each
 * nudges once: a one-shot is `fired` (still open until ticked), a repeating one moves on.
 */
export async function dueReminders(brain: string, now: Date): Promise<Reminder[]> {
  const list = await loadReminders(brain);
  const due = list.filter((r) => !r.done && !r.fired && new Date(r.due) <= now);
  if (!due.length) return [];
  const fired = due.map((r) => ({ ...r }));
  for (const r of due) {
    if (r.every) r.due = nextMatch(r.every, now).toISOString();
    else r.fired = true;
  }
  await save(brain, list);
  return fired;
}
