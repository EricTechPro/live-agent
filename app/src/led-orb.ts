// Jett's LED orb: a dot-matrix orb drawn square by square on a canvas. The setup
// wizard's mascot, the main view's orb and the mini orb are all this one drawing.
//
//   const orb = mountLedOrb(canvas);
//   orb.icon("mic");          // dissolve to the step's pixel icon (wizard)
//   orb.set("speak", 1.2);    // a mood for 1.2 s: idle | listen | speak | think | hype | off
//   mountLedOrb(canvas, { follow: () => "listen" });   // main view: the mood follows the app's state
//
// Moods: idle breathes; listen sends a ring pulse out; speak runs the wave fast and
// pulses the orb; think twinkles; off is dim and still (starting, offline).
//
// The canvas edge sits 10.5 units from the centre on a 22x22 grid. Each shape maps
// a cell (u, v = offset from the centre, in units) to a brightness: 0 off, 0..1 teal,
// 2 white-hot. Written fresh for live-agent (the Pixel mockup's Orb); no Roamies code.

import type { Wave } from "./orb-wave.ts";

export type Mood = "idle" | "listen" | "speak" | "think" | "hype" | "off";

export interface WizardOrb {
  set(mood: Mood, secs?: number): void;
  icon(name: string): void;
  stop(): void;
}

type Shape = (u: number, v: number, s: number) => number;

const N = 22;
const OFF = 0.04; // an unlit LED, drawn dark like the logo

export interface LedOrbOptions {
  /** Read every frame: the mood to show when no timed mood (`set` with secs) is running. */
  follow?: () => Mood;
  /** Read every frame: the lit LEDs' colour as "r,g,b" (ticket 37: each call state has its own). Default teal. */
  tint?: () => string;
  /** Read every frame: the user's mic level, 0..1. While listening the orb swells and its ring brightens with it. */
  level?: () => number;
  /**
   * Read every frame: the wave to draw (orb-wave.ts, ticket 38). Given, the wave moves only
   * when it says so: flat at rest, a sweeping dot while thinking, and nothing else on the
   * orb twinkles or breathes while it is flat. Without it (the wizard) the old moods run.
   */
  wave?: () => Wave;
}

export function mountLedOrb(canvas: HTMLCanvasElement, options: LedOrbOptions = {}): WizardOrb {
  const g = canvas.getContext("2d")!;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let mood: Mood = "idle";
  let moodUntil = 0;
  let t = 0;
  let icon = "wave";
  let prev = "wave";
  let switchAt = -9;
  let p = 1;
  let frame = 0;
  let last = 0;
  let wph = 0; // the wave's phase: it runs faster while speaking
  let ta = 0; // the clock for twinkles and breathing; stands still while the wave is flat
  let wv: Wave | undefined = options.wave?.();
  const seed = Array.from({ length: N * N }, () => Math.random());

  const tw = (s: number) => 0.3 + 0.45 * Math.abs(Math.sin(ta * 1.6 + s * 9)); // twinkle for dim dots
  const box = (u: number, v: number, x0: number, y0: number, x1: number, y1: number) => u >= x0 && u <= x1 && v >= y0 && v <= y1;
  const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - k * dx, py - ay - k * dy);
  };

  const SHAPES: Record<string, Shape> = {
    wave(u, v, s) {
      // The Jett logo: LED orb, unlit dots inside, a white-hot sine wave across.
      const d = Math.hypot(u, v) / 10.5;
      if (d > 1) return 0;
      if (wv) {
        // Ticket 38: flat, a real wave, or a dot sweeping along a dim line.
        if (wv.kind === "sweep") {
          if (Math.hypot(u - (wv.sweep ?? 0) * 7.5, v) < 1.7) return 2;
          if (Math.abs(v) < 0.6) return 0.5;
        } else if (Math.abs(v - wv.amp * 4.2 * Math.sin(u * 0.5 + wph) * (1 - 0.6 * d * d)) < 1) return 2;
      } else {
        const amp = mood === "speak" ? 3.6 : mood === "off" ? 1.4 : 2.9;
        if (Math.abs(v - amp * Math.sin(u * 0.5 + wph) * (1 - 0.6 * d * d)) < 1) return 2;
      }
      if (d > 0.8) return s > 0.2 ? tw(s) + 0.2 : OFF;
      if (mood === "think") return s > 0.6 ? tw(s) : OFF;
      return s > 0.94 ? 0.5 : OFF;
    },
    key(u, v) {
      // Ring head, shaft, two teeth.
      const rr = Math.hypot(u + 4.5, v);
      if (rr <= 5.4 && rr >= 2.6) return u < -6 && v < -1.5 ? 2 : 1;
      if (box(u, v, 0.5, -1, 9.5, 1)) return 1;
      if (box(u, v, 5, 1, 6.5, 4.5) || box(u, v, 8, 1, 9.5, 3.5)) return 1;
      return 0;
    },
    mic(u, v) {
      // Capsule, holder, stem, base.
      const cap = (Math.abs(u) <= 3.5 && v >= -6 && v <= -1) || Math.hypot(u, v + 6) <= 3.6 || Math.hypot(u, v + 1) <= 3.6;
      if (cap) return u < -1.6 && v < -2 ? 2 : Math.round(v) % 2 ? 0.55 : 1;
      const hr = Math.hypot(u, v + 1);
      if (v >= -1 && hr >= 5.5 && hr <= 7) return 1;
      if (Math.abs(u) <= 1 && v >= 6 && v <= 8.5) return 1;
      if (Math.abs(u) <= 4.5 && v > 8.5 && v <= 10) return 1;
      return 0;
    },
    folder(u, v, s) {
      // Tab + body, bright edges, sparse inside.
      if (box(u, v, -9.5, -8, -2, -5.5)) return 1;
      if (!box(u, v, -9.5, -5.5, 9.5, 7.5)) return 0;
      if (u < -8.5 || u > 8.5 || v < -4.5 || v > 6.5) return 1;
      if (Math.abs(v + 1.5) < 0.6) return 2;
      return s > 0.55 ? tw(s) * 0.6 : 0;
    },
    bubble(u, v) {
      // Speech bubble with three dots that blink in turn.
      const inBody = box(u, v, -9.5, -8, 9.5, 4) && !(Math.abs(u) > 8.5 && (v < -7 || v > 3));
      const tail = v > 4 && v <= 8.5 && u >= -6.5 && u <= -6.5 + (8.5 - v) * 0.9;
      if (!inBody && !tail) return 0;
      for (let i = 0; i < 3; i++) if (Math.hypot(u - (i - 1) * 4.5, v + 2) < 1.5) return Math.floor(t * 3) % 3 === i ? 0 : 0.25;
      return u < -7 && v < -5 ? 2 : 0.9;
    },
    shield(u, v, s) {
      // Shield outline with a white tick.
      if (v < -9 || v > 10) return 0;
      const hw = v <= 1 ? 8 : 8 * (1 - (v - 1) / 9.5);
      if (Math.abs(u) > hw) return 0;
      if (seg(u, v, -4, 0, -1, 3) < 0.8 || seg(u, v, -1, 3, 4.5, -3.5) < 0.8) return 2;
      if (Math.abs(u) > hw - 1.5 || v < -7.8) return 1;
      return s > 0.6 ? 0.22 : 0;
    },
    hi(u, v, s) {
      // Smiling orb.
      const d = Math.hypot(u, v);
      if (d > 9.8) return 0;
      if (Math.hypot(u + 3.5, v + 2.5) < 1.5 || Math.hypot(u - 3.5, v + 2.5) < 1.5) return 0;
      const sm = Math.hypot(u, v - 0.5);
      if (sm >= 4 && sm <= 5.5 && v > 1.8) return 0;
      if (Math.hypot(u + 5, v + 5.5) < 1.6) return 2;
      return d > 8.6 ? 1 : 0.5 + 0.25 * Math.abs(Math.sin(t * 1.6 + s * 9));
    },
  };

  // The step icon, with the dissolve from the previous one (sparkles on its edge).
  function cell(u: number, v: number, s: number): number {
    let a = SHAPES[s < p ? icon : prev]!(u, v, s);
    if (p < 1 && Math.abs(s - p) < 0.07 && (a || SHAPES[prev]!(u, v, s))) return 2;
    const d = Math.hypot(u, v) / 10.5;
    if (!wv && mood === "listen" && d <= 1 && Math.abs(d - ((t * 0.8) % 1)) < 0.08) a = Math.max(a, 0.9);
    return a;
  }

  function draw() {
    const r0 = N / 2 - 0.5;
    const us = 10.5 / r0;
    const W = canvas.width;
    const size = W / N;
    const gap = Math.max(1, size * 0.12);
    g.clearRect(0, 0, W, W);
    g.globalAlpha = wv?.dim ? 0.4 : mood === "off" ? 0.45 : 1;
    const rgb = options.tint?.() ?? "120,255,226";
    const lvl = mood === "listen" ? Math.min(1, Math.max(0, options.level?.() ?? 0)) : 0;
    const k = wv
      ? 1 + (mood === "listen" ? 0.16 * lvl : mood === "speak" ? 0.05 * wv.amp : 0)
      : 1 +
        (mood === "speak" ? 0.09 * Math.abs(Math.sin(t * 9)) : mood === "listen" ? 0.03 * Math.sin(t * 6) + 0.16 * lvl : 0.025 * Math.sin(t * 2));
    const hop = mood === "hype" ? Math.max(0, Math.sin(Math.min(1, (t - (moodUntil - 0.6)) / 0.6) * Math.PI)) * 3 : 0;
    p = still ? 1 : Math.min(1, (t - switchAt) / 0.45);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const s = seed[y * N + x]!;
        const a = cell(((x - r0) * us) / k, ((y - r0) * us + hop) / k, s);
        if (!a) continue;
        g.fillStyle =
          a === OFF ? "#14302f" : a >= 2 ? "rgba(232,255,250,1)" : `rgba(${rgb},${a === 1 ? 0.82 + 0.18 * Math.sin(ta * 2 + s * 9) : Math.min(1, a + lvl * 0.4)})`;
        g.fillRect(x * size + gap, y * size + gap, size - gap * 2, size - gap * 2);
      }
    }
  }

  function loop(ts: number) {
    t = ts / 1000;
    const dt = Math.min(0.1, Math.max(0, t - last));
    last = t;
    if (moodUntil && t > moodUntil) {
      mood = "idle";
      moodUntil = 0;
    }
    if (!moodUntil && options.follow) mood = options.follow();
    wv = options.wave?.();
    if (wv) {
      // The wave runs only while there is one; everything else stands still while it is flat.
      if (!still && wv.kind === "wave") wph += dt * (mood === "speak" ? 8 : 6);
      if (!still && wv.kind !== "flat") ta += dt;
    } else {
      wph += dt * (mood === "speak" ? 9 : mood === "off" ? 0 : mood === "think" ? 2 : 4);
      ta = t;
    }
    draw();
    if (!still) frame = requestAnimationFrame(loop);
  }
  frame = requestAnimationFrame(loop);
  // Reduced motion: no animation, but a followed orb still changes with the app's state.
  const slow = still && (options.follow || options.wave) ? setInterval(() => loop(performance.now()), 250) : undefined;

  return {
    set(next, secs) {
      mood = next;
      moodUntil = secs ? t + secs : 0;
      if (still) draw();
    },
    icon(name) {
      if (name === icon || !SHAPES[name]) return;
      prev = icon;
      icon = name;
      switchAt = t;
      if (still) draw();
    },
    stop() {
      cancelAnimationFrame(frame);
      clearInterval(slow);
    },
  };
}
