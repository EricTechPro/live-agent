// Jett's icons, drawn from code (ticket 40): no outside assets, nothing borrowed.
//
//   bun app/scripts/make-icon.ts            # writes the sources below
//   cd app && bunx tauri icon src-tauri/icons/source/jett-1024.png   # every app icon size
//
// - src-tauri/icons/source/jett-1024.png: the app icon. The teal pixel LED orb with a
//   white-hot wave across it, on a dark rounded square (macOS icon grid: an 824 px body
//   inside 1024, so it sits with the system's icons).
// - src-tauri/icons/tray-template.png (18 px) and tray-template@2x.png (36 px): the
//   menu-bar icon. Black on transparent, used as a template image, so macOS paints it
//   for light and dark menu bars. A ring of dots and the wave, on a pixel grid that
//   lands on whole pixels at 18 and 36 px, so it stays crisp.
//
// The PNG encoder is the tiny one below (zlib + CRC), so this needs no packages.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type RGBA = [number, number, number, number];

class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  /** Paint one pixel over what is there (source-over). */
  blend(x: number, y: number, [r, g, b, a]: RGBA) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const da = d[i + 3]! / 255;
    const sa = a / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    d[i] = (r * sa + d[i]! * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1]! * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2]! * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }
  /** Fill where `cover(x, y)` gives 0..1 coverage, 4x4 supersampled for smooth edges. */
  fill(x0: number, y0: number, x1: number, y1: number, cover: (x: number, y: number) => boolean, color: (x: number, y: number) => RGBA) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        let n = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (cover(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
        if (!n) continue;
        const c = color(x + 0.5, y + 0.5);
        this.blend(x, y, [c[0], c[1], c[2], (c[3] * n) / 16]);
      }
    }
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.data.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  let c = 0xffffffff;
  for (const b of Buffer.concat([head.subarray(4), body])) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

const roundRect = (x0: number, y0: number, size: number, r: number) => (x: number, y: number) => {
  const dx = Math.max(x0 + r - x, 0, x - (x0 + size - r));
  const dy = Math.max(y0 + r - y, 0, y - (y0 + size - r));
  return x >= x0 && y >= y0 && x <= x0 + size && y <= y0 + size && dx * dx + dy * dy <= r * r;
};

/** The wave's row for each column: one continuous line, about two LEDs up and down. */
function waveRows(n: number): number[] {
  const c = (n - 1) / 2;
  return Array.from({ length: n }, (_, gx) => Math.round(c - 2.4 * Math.sin(((gx - c) / c) * Math.PI)));
}

/**
 * The orb on an N x N grid of LEDs: 0 off, 1 the teal rim, 2 the white-hot wave, 0.06 an
 * unlit LED. The same picture as the app's LED orb (app/src/led-orb.ts), with fewer,
 * bigger LEDs so it reads at small sizes.
 */
function orbCell(gx: number, gy: number, n: number, rows: number[]): number {
  const c = (n - 1) / 2;
  const inside = (x: number, y: number) => Math.hypot(x - c, y - c) <= c + 0.4;
  if (!inside(gx, gy)) return 0;
  // The line steps one row at a time toward the next column's row, so it never breaks.
  const here = rows[gx]!;
  const next = rows[gx + 1] ?? here;
  const [lo, hi] = next > here ? [here, next - 1] : next < here ? [next + 1, here] : [here, here];
  // Two LEDs thick, so the wave still reads at 16 px.
  if (gy >= lo && gy <= hi + 1) return 2;
  // The rim: every LED with an empty neighbour (8 around), a ring with no holes.
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    if (!inside(gx + dx, gy + dy)) return 1;
  }
  return 0.06;
}

function appIcon(): Canvas {
  const S = 1024;
  const cv = new Canvas(S, S);
  // The macOS icon body: 824 px with a 185 px corner, centred (macOS adds the shadow).
  const body = { x: 100, y: 100, size: 824, r: 185 };
  cv.fill(body.x, body.y, body.x + body.size, body.y + body.size, roundRect(body.x, body.y, body.size, body.r), (_x, y) => {
    const t = (y - body.y) / body.size; // a dark teal-black, a little lighter at the top
    return [Math.round(16 - 9 * t), Math.round(36 - 20 * t), Math.round(40 - 22 * t), 255];
  });
  // A faint inner edge so it holds on a dark Dock.
  const edge = roundRect(body.x + 3, body.y + 3, body.size - 6, body.r - 3);
  cv.fill(body.x, body.y, body.x + body.size, body.y + body.size, (x, y) => roundRect(body.x, body.y, body.size, body.r)(x, y) && !edge(x, y), () => [120, 255, 226, 46]);
  // The orb: a soft teal glow, then the LEDs.
  const N = 15;
  const cell = 40;
  const ox = (S - N * cell) / 2;
  const oy = ox;
  const cx = S / 2;
  for (let y = body.y; y < body.y + body.size; y++) {
    for (let x = body.x; x < body.x + body.size; x++) {
      const r = Math.hypot(x - cx, y - cx);
      const glow = Math.max(0, 1 - Math.abs(r - 290) / 120);
      if (glow > 0 && roundRect(body.x, body.y, body.size, body.r)(x + 0.5, y + 0.5)) cv.blend(x, y, [120, 255, 226, 34 * glow * glow]);
    }
  }
  const gap = 5;
  const rows = waveRows(N);
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const a = orbCell(gx, gy, N, rows);
      if (!a) continue;
      const color: RGBA = a >= 2 ? [236, 255, 251, 255] : a === 1 ? [92, 240, 208, 255] : [24, 58, 58, 255];
      const x0 = ox + gx * cell + gap;
      const y0 = oy + gy * cell + gap;
      const size = cell - gap * 2;
      cv.fill(x0, y0, x0 + size, y0 + size, roundRect(x0, y0, size, 6), () => color);
    }
  }
  return cv;
}

/**
 * The menu-bar template, drawn on the 18 pt grid and rendered at 1x and 2x: twelve round
 * LEDs in a ring and a solid wave through the middle. Black on transparent: template
 * images are alpha only.
 */
function trayIcon(scale: number): Canvas {
  const size = 18 * scale;
  const cv = new Canvas(size, size);
  const c = 9 * scale;
  const black = (): RGBA => [0, 0, 0, 255];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = c + Math.cos(a) * 7.4 * scale;
    const y = c + Math.sin(a) * 7.4 * scale;
    const r = 1.25 * scale;
    cv.fill(x - r, y - r, x + r, y + r, (px, py) => Math.hypot(px - x, py - y) <= r, black);
  }
  // The wave: one period of a sine, 1.7 pt thick, from -5 pt to 5 pt.
  const half = 0.85 * scale;
  const waveY = (x: number) => c - 2.3 * scale * Math.sin(((x - c) / (5 * scale)) * Math.PI);
  cv.fill(c - 5.6 * scale, c - 4 * scale, c + 5.6 * scale, c + 4 * scale, (px, py) => {
    if (Math.abs(px - c) > 5 * scale + half) return false;
    // Distance to the curve, near enough: the vertical gap scaled by the slope.
    const k = Math.max(-5 * scale, Math.min(5 * scale, px - c)) + c;
    const slope = (waveY(k + 0.01) - waveY(k - 0.01)) / 0.02;
    return (Math.abs(py - waveY(k)) / Math.sqrt(1 + slope * slope) <= half && Math.abs(px - c) <= 5 * scale) || Math.hypot(px - k, py - waveY(k)) <= half;
  }, black);
  return cv;
}

const icons = join(import.meta.dir, "../src-tauri/icons");
const write = (path: string, cv: Canvas) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, cv.png());
  console.log(`wrote ${path} (${cv.w}x${cv.h})`);
};
write(join(icons, "source/jett-1024.png"), appIcon());
write(join(icons, "tray-template.png"), trayIcon(1));
write(join(icons, "tray-template@2x.png"), trayIcon(2));
