// Follow the call's own mic track through a Web Audio analyser (ticket 37). Nothing is
// recorded or sent anywhere; mic-level.ts turns each block into a 0..1 level.
import { levelOf } from "./mic-level.ts";

/** `read()` is smoothed (fast up, slow down) so the orb and the bars don't flicker. */
export function followMic(track: MediaStreamTrack): { read(): number; stop(): void } {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let level = 0;
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      const now = levelOf(buf);
      level = now > level ? now : level * 0.9 + now * 0.1;
      return level;
    },
    stop() {
      source.disconnect();
      void ctx.close();
    },
  };
}
