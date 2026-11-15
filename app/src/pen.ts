// The pen's clock (ticket 34). Pure, like sketch.ts:
//
//   pen = penAddBeat(pen, { key, say, ids, lengths }, now, reduced)  // a `canvas.beat` arrived
//   pen = penSpeak(pen, key, now, reduced)                           // `canvas.speak`: its line starts now
//   { pen, dropped } = penInterrupt(pen, now)                        // `interrupted`: stop the pen
//   slotOf(pen, id)                                                  // when a mark draws
//
// The clock is text-based: a beat lasts as long as its `say` line takes to say
// (caption length / speaking rate), and its marks spread over that time, longer
// marks taking longer. The core's `canvas.speak` (from the voice's transcript)
// says when a line really starts. A beat whose signal has not come waits a
// little after the beat before it (`holdMs`), then draws anyway, so text turns
// and reworded lines still draw every beat. When the voice gets ahead, the marks
// still drawing hurry to finish (`catchUpMs`) and the spoken beat follows.
// The hook for real audio timing: `beatMs` takes the speaking rate.
import type { Slot } from "./sketch.ts";

export const VOICE = {
  /** About 150 words a minute. */
  charsPerSec: 15,
  minBeatMs: 900,
  maxBeatMs: 9000,
  /** How long a beat waits for its line after the beat before it ends. */
  holdMs: 1500,
  /** How fast late marks finish once the voice has moved on. */
  catchUpMs: 350,
  minMarkMs: 200,
  markGapMs: 140,
} as const;

export interface PenBeat {
  /** `<tool call id>:<beat index>`, the same as the scene's beatKey. */
  key: string;
  say: string;
  ids: string[];
  /** Pen travel of each mark (sketch.ts `inkFor(mark).length`). */
  lengths: number[];
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

/** Marks one after another over `ms` from `start`, each in proportion to its length. */
function spread(start: number, ms: number, lengths: number[]): Slot[] {
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const gap = lengths.length > 1 ? Math.min(VOICE.markGapMs, (ms * 0.3) / (lengths.length - 1)) : 0;
  const avail = ms - gap * (lengths.length - 1);
  let t = start;
  return lengths.map((length) => {
    const slot = { start: t, end: t + Math.max(VOICE.minMarkMs, (avail * length) / total) };
    t = slot.end + gap;
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
  const slots = reduced ? beat.lengths.map(() => ({ start: now, end: now })) : spread(start, beatMs(beat.say), beat.lengths);
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
  beat.slots = spread(free, beatMs(beat.say), beat.lengths);
  // The beats after it wait for their own lines again, from the new end.
  for (let j = i + 1; j < beats.length; j++) {
    const b = beats[j]!;
    if (b.spoken || startsAt(b) <= now) break;
    b.slots = spread(beatEnd(beats[j - 1]!) + VOICE.holdMs, beatMs(b.say), b.lengths);
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
