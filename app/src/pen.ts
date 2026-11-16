// The pen's clock (ticket 34). Pure, like sketch.ts:
//
//   pen = penAddBeat(pen, { key, say, ids, durations }, now, reduced)  // a `canvas.beat` arrived
//   pen = penSpeak(pen, key, now, reduced)                           // `canvas.speak`: its line starts now
//   { pen, dropped } = penInterrupt(pen, now)                        // `interrupted`: stop the pen
//   slotOf(pen, id)                                                  // when a mark draws
//
// The clock is text-based: a beat lasts as long as its `say` line takes to say
// (caption length / speaking rate, at least 1.2 s). Its marks start spread across
// the first 80% of that line (mark i of n at start + 0.8 x line x i / n) and each
// takes its natural drawing time (motion.ts). A mark that cannot start on time
// because the pen is still busy runs faster, up to 2.5x, to catch up. The core's `canvas.speak` (from the voice's transcript)
// says when a line really starts. A beat whose signal has not come waits a
// little after the beat before it (`holdMs`), then draws anyway, so text turns
// and reworded lines still draw every beat. When the voice gets ahead, the marks
// still drawing hurry to finish (`catchUpMs`) and the spoken beat follows.
// The hook for real audio timing: `beatMs` takes the speaking rate.
import type { Slot } from "./sketch.ts";

export const VOICE = {
  /** About 150 words a minute. */
  charsPerSec: 15,
  minBeatMs: 1200,
  maxBeatMs: 9000,
  /** How long a beat waits for its line after the beat before it ends. */
  holdMs: 1500,
  /** How fast late marks finish once the voice has moved on. */
  catchUpMs: 350,
  minMarkMs: 200,
  /** Marks start across this share of the line. */
  release: 0.8,
  /** How much faster the pen may go to catch up. */
  maxSpeedup: 2.5,
  /** The pen's flight between two marks. */
  flyMs: 140,
} as const;

export interface PenBeat {
  /** `<tool call id>:<beat index>`, the same as the scene's beatKey. */
  key: string;
  say: string;
  ids: string[];
  /** Each mark's natural drawing time in ms (motion.ts `unitPlan(...).total`). */
  durations: number[];
  slots: Slot[];
  /** Its `canvas.speak` came. */
  spoken: boolean;
}

export interface Pen {
  beats: PenBeat[];
}

export const emptyPen: Pen = { beats: [] };

/** How long a line takes to say, in ms. */
export function beatMs(say: string, charsPerSec: number = VOICE.charsPerSec): number {
  const ms = (say.trim().length / charsPerSec) * 1000;
  return Math.round(Math.min(VOICE.maxBeatMs, Math.max(VOICE.minBeatMs, ms)));
}

/**
 * Marks over a line of `ms` from `start`: mark i is released at start + 0.8 x ms x i / n.
 * The pen draws one mark at a time; a mark released while the pen is busy starts when
 * it is free (after a short flight) and runs faster, up to 2.5x, to end about when it
 * would have ended had it started on time.
 */
export function spread(start: number, ms: number, durations: number[]): Slot[] {
  const n = durations.length;
  let free = start;
  return durations.map((d, i) => {
    const natural = Math.max(VOICE.minMarkMs, d);
    const release = start + (ms * VOICE.release * i) / n;
    const begin = Math.max(release, i ? free + VOICE.flyMs : free);
    const late = begin - release;
    const speed = Math.min(VOICE.maxSpeedup, (natural + late) / natural);
    const slot = { start: begin, end: begin + natural / speed };
    free = slot.end;
    return slot;
  });
}

/** Squeeze the marks not yet finished into [from, until]; a mark under way keeps its start. Only ever shortens. */
function hurry(slots: Slot[], from: number, until: number): Slot[] {
  const left = slots.filter((s) => s.end > from).length;
  if (!left) return slots;
  const share = (until - from) / left;
  let t = from;
  return slots.map((s) => {
    if (s.end <= from) return s;
    // Earlier marks only ever end sooner, so t never passes a later mark's own start.
    const start = s.start <= from ? s.start : t;
    const end = Math.min(s.end, until, t + share);
    t = end;
    return { start, end };
  });
}

const beatEnd = (b: PenBeat) => b.slots.at(-1)?.end ?? -Infinity;
const startsAt = (b: PenBeat) => b.slots[0]?.start ?? Infinity;

/** A beat arrived. It starts now if the pen rests, else it waits for its line after the last beat (`holdMs`). */
export function penAddBeat(pen: Pen, beat: Omit<PenBeat, "slots" | "spoken">, now: number, reduced: boolean): Pen {
  // Beats long done are forgotten: nothing will move them again.
  const beats = pen.beats.filter((b) => beatEnd(b) >= now);
  const last = beats.at(-1);
  const start = !last || beatEnd(last) <= now ? now : beatEnd(last) + VOICE.holdMs;
  const slots = reduced ? beat.durations.map(() => ({ start: now, end: now })) : spread(start, beatMs(beat.say), beat.durations);
  return { beats: [...beats, { ...beat, slots, spoken: false }] };
}

/** The voice starts this beat's line now. */
export function penSpeak(pen: Pen, key: string, now: number, reduced: boolean): Pen {
  const i = pen.beats.findIndex((b) => b.key === key);
  if (i < 0) return pen;
  const beats = pen.beats.map((b) => ({ ...b }));
  const beat = beats[i]!;
  beat.spoken = true;
  // Already drawing (or drawn): the pen is ahead of the voice, let it be.
  if (reduced || startsAt(beat) <= now) return { beats };
  // Behind: what the earlier beats still owe hurries, then this beat takes its line's time.
  let free = now;
  for (let j = 0; j < i; j++) {
    beats[j]!.slots = hurry(beats[j]!.slots, now, now + VOICE.catchUpMs);
    free = Math.max(free, beatEnd(beats[j]!));
  }
  beat.slots = spread(free, beatMs(beat.say), beat.durations);
  // The beats after it wait for their own lines again, from the new end.
  for (let j = i + 1; j < beats.length; j++) {
    const b = beats[j]!;
    if (b.spoken || startsAt(b) <= now) break;
    b.slots = spread(beatEnd(beats[j - 1]!) + VOICE.holdMs, beatMs(b.say), b.durations);
  }
  return { beats };
}

/** The user talked over Jett: spoken or started beats finish now; the rest is dropped (and stays undrawn). */
export function penInterrupt(pen: Pen, now: number): { pen: Pen; dropped: string[] } {
  const dropped: string[] = [];
  const beats: PenBeat[] = [];
  for (const b of pen.beats) {
    if (b.spoken || startsAt(b) <= now) {
      beats.push({ ...b, slots: b.slots.map((s) => ({ start: Math.min(s.start, now), end: Math.min(s.end, now) })) });
    } else dropped.push(...b.ids);
  }
  return { pen: { beats }, dropped };
}

/** When a mark draws, if the pen still knows it. */
export function slotOf(pen: Pen, id: string): Slot | undefined {
  for (const b of pen.beats) {
    const i = b.ids.indexOf(id);
    if (i >= 0) return b.slots[i];
  }
  return undefined;
}
