// Standard 5-field cron, in local time: minute hour day-of-month month day-of-week.
//
//   const cron = parseCron("0 8 * * 1-5");   // weekdays at 8:00; throws a plain message if bad
//   cronMatches(cron, new Date());            // is this minute a run?
//
// Why cron: people say "every weekday at 8", the model writes "0 8 * * 1-5", and
// both the file and the code can read it. Numbers only (no "mon" or "jan"):
// `*`, lists `1,3`, ranges `1-5` and steps `*/15` or `0-30/10`. Sunday is 0 or 7.
// Day of month and day of week both set: either one matches (as in every cron).

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

export interface Cron {
  sets: Set<number>[];
  /** Was the day field `*`? (for the day-of-month / day-of-week either-one rule) */
  anyDom: boolean;
  anyDow: boolean;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`"${expr}" is not a schedule: use 5 fields "minute hour day month weekday", e.g. "0 8 * * 1-5" for weekdays at 8`);
  }
  const sets = parts.map((part, i) => {
    const { name, min, max } = FIELDS[i]!;
    const set = new Set<number>();
    for (const item of part.split(",")) {
      const m = item.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
      const lo = m?.[2] !== undefined ? Number(m[2]) : min;
      const hi = m?.[3] !== undefined ? Number(m[3]) : m?.[2] !== undefined && !m[4] ? lo : max;
      const step = m?.[4] !== undefined ? Number(m[4]) : 1;
      if (!m || lo < min || hi > max || lo > hi || step < 1) {
        throw new Error(`"${expr}": the ${name} field "${part}" must be numbers from ${min} to ${max}`);
      }
      for (let v = lo; v <= hi; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    return set;
  });
  return { sets, anyDom: parts[2] === "*", anyDow: parts[4] === "*" };
}

export function cronMatches({ sets, anyDom, anyDow }: Cron, at: Date): boolean {
  const [min, hour, dom, month, dow] = sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  if (!min.has(at.getMinutes()) || !hour.has(at.getHours()) || !month.has(at.getMonth() + 1)) return false;
  const domOk = dom.has(at.getDate());
  const dowOk = dow.has(at.getDay());
  return anyDom || anyDow ? domOk && dowOk : domOk || dowOk;
}
