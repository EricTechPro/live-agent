// The wave inside the orb (ticket 38). Pure: the call's look plus the live levels in,
// the wave to draw out. It moves only when something really happens, so a moving wave
// always means "I hear you" or "I'm talking":
//
// - at rest, call ended, starting, offline: a flat line
// - muted: a flat line, dimmed (the mic-slash badge is drawn by the page)
// - listening: the height follows your mic level; flat while you are quiet
// - speaking: the height follows Jett's output level; with none known, a gentle
//   speech-like motion, only while speaking
// - thinking, connecting: a slow dot sweeping along a flat line, not the speech wave
// With prefers-reduced-motion nothing moves over time (levels still set the height).
import type { CallLook } from "./call-state.ts";

export type WaveKind = "flat" | "wave" | "sweep";

export interface Wave {
  kind: WaveKind;
  /** The wave's height, 0..1 (0 for flat and sweep). */
  amp: number;
  /** Draw the orb dimmed (muted). */
  dim: boolean;
  /** Sweep only: where the dot is along the line, -1 (left) .. 1 (right). */
  sweep?: number;
}

export interface WaveInputs {
  look: CallLook;
  /** Seconds, for the motions that run on their own (sweep, speech without a level). */
  t: number;
  /** Your mic level, 0..1 (mic-level.ts). */
  mic?: number;
  /** Jett's output level, 0..1, when known. */
  voice?: number;
  /** prefers-reduced-motion. */
  still?: boolean;
}

/** Below this a level counts as quiet: the line stays flat. */
export const QUIET = 0.06;

const flat = (dim = false): Wave => ({ kind: "flat", amp: 0, dim });
const fromLevel = (level: number): Wave => (level < QUIET ? flat() : { kind: "wave", amp: Math.min(1, level), dim: false });

export function waveFor({ look, t, mic = 0, voice, still = false }: WaveInputs): Wave {
  switch (look) {
    case "muted":
      return flat(true);
    case "listening":
      return fromLevel(mic);
    case "speaking": {
      if (voice !== undefined) return fromLevel(voice);
      // No output level: two slow sines multiplied read like syllables, 0.25 .. 0.65.
      const amp = still ? 0.45 : 0.25 + 0.4 * Math.abs(Math.sin(t * 5.1) * Math.sin(t * 1.3 + 0.7));
      return { kind: "wave", amp, dim: false };
    }
    case "thinking":
    case "joining":
      return { kind: "sweep", amp: 0, dim: false, sweep: still ? 0 : Math.sin(t * 1.4) };
    default:
      return flat();
  }
}
