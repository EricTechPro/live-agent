// How loud the user is right now (ticket 37): the orb swells and the equaliser bars
// move with your voice while Jett listens, so you can see you are heard. Pure; the Web
// Audio part that feeds it is mic-follow.ts.

/** The loudness of one block of samples as 0..1: RMS, scaled so normal speech reaches about 0.6 to 1. */
export function levelOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  // Speech RMS is roughly 0.02 (quiet) to 0.2 (loud); below the floor is room noise.
  return Math.max(0, Math.min(1, (rms - 0.008) * 7));
}
