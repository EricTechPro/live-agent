// The sketch canvas (tickets 32, 33): paints the core's `canvas.*` marks on the
// Canvas tab with a pen that draws each stroke from 0 to 1, one mark after
// another, and shows the beat's `say` line under the board while it draws.
//
// The state is sketch.ts (pure, tested); this file only paints it. Finished marks
// go onto a cache canvas once, so each frame draws the cache plus the one mark the
// pen is on. The board is the core's 1000 x 600, scaled into the panel and drawn
// at the screen's pixel ratio so it stays sharp on Retina.
// The Mermaid `diagram` view (ticket 16) shares the tab: whichever came last shows.
// Idea from Roamies (AGPL): idea only, our own code.
import type { CoreClient } from "./core-client.ts";
import { addCanvasEvent, emptyScene, fitBoard, inkFor, partialPoints, partsAt, planMarks, taper, type Ink, type Part, type Pt, type Scene, type Slot } from "./sketch.ts";

interface Drawn {
  ink: Ink;
  slot: Slot;
  say: string;
}

const ERASE_MS = 420;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const font = (size: number) => `500 ${size}px "Martian Mono", ui-monospace, monospace`;

export function mountSketch(core: CoreClient, host: HTMLElement) {
  const figure = Object.assign(document.createElement("figure"), { className: "sketch", hidden: true });
  const board = Object.assign(document.createElement("div"), { className: "pf sketch-board" });
  const canvas = Object.assign(document.createElement("canvas"), { className: "sketch-canvas" });
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Sketch");
  const caption = Object.assign(document.createElement("figcaption"), { className: "sketch-say" });
  caption.setAttribute("aria-live", "polite");
  board.append(canvas);
  figure.append(board, caption);
  host.insertBefore(figure, host.querySelector(".canvas-empty"));

  const ctx = canvas.getContext("2d")!;
  const cache = document.createElement("canvas");
  const cacheCtx = cache.getContext("2d")!;
  let cached = new Set<string>();

  let scene: Scene = emptyScene;
  let drawn = new Map<string, Drawn>();
  // Erased marks while they stroke out (ticket 33).
  let fading = new Map<string, { ink: Ink; slot: Slot }>();
  let penFreeAt = 0;
  let fit = fitBoard(0, 0);
  let dpr = 1;
  let frame = 0;

  // ---- size: CSS pixels times the pixel ratio ----
  new ResizeObserver(() => {
    const w = board.clientWidth;
    const h = board.clientHeight;
    dpr = window.devicePixelRatio || 1;
    canvas.width = cache.width = Math.round(w * dpr);
    canvas.height = cache.height = Math.round(h * dpr);
    fit = fitBoard(w, h);
    cached = new Set();
    kick();
  }).observe(board);

  // ---- events ----
  core.onEvent((event) => {
    if (event.type === "diagram") host.dataset.view = "diagram";
    if (event.type !== "chat.started" && !event.type.startsWith("canvas.")) return;
    scene = addCanvasEvent(scene, event);
    if (event.type === "chat.started") {
      drawn = new Map();
      fading = new Map();
      cached = new Set();
      penFreeAt = 0;
      caption.textContent = "";
      figure.hidden = true;
      delete host.dataset.view;
      return;
    }
    if (event.type === "canvas.edit") {
      // The changed mark redraws at once with a quick pen; the old one goes from the cache.
      const old = drawn.get(event.mark.id);
      if (!old) return;
      const ink = inkFor(event.mark);
      const now = performance.now();
      const [slot] = planMarks({ penFreeAt: 0, now, lengths: [ink.length], newBeat: false, reducedMotion: reducedMotion() });
      drawn.set(event.mark.id, { ...old, ink, slot: slot! });
      cached = new Set();
      kick();
      return;
    }
    if (event.type === "canvas.erase") {
      // Erased marks stroke out backwards, then they are gone.
      const now = performance.now();
      const ms = reducedMotion() ? 0 : ERASE_MS;
      for (const id of event.ids) {
        const d = drawn.get(id);
        if (!d) continue;
        drawn.delete(id);
        if (d.slot.start <= now) fading.set(id, { ink: d.ink, slot: { start: now, end: now + ms } });
      }
      cached = new Set();
      kick();
      return;
    }
    if (event.type !== "canvas.beat") return;
    host.dataset.view = "sketch";
    figure.hidden = false;
    const inks = event.marks.map(inkFor);
    const now = performance.now();
    const slots = planMarks({ penFreeAt, now, lengths: inks.map((i) => i.length), newBeat: true, reducedMotion: reducedMotion() });
    event.marks.forEach((mark, i) => {
      // A mark redrawn under a known id: start the cache over so the old one goes.
      if (drawn.has(mark.id)) cached = new Set();
      drawn.set(mark.id, { ink: inks[i]!, slot: slots[i]!, say: event.say });
    });
    penFreeAt = Math.max(penFreeAt, slots.at(-1)?.end ?? now);
    canvas.setAttribute("aria-label", `Sketch: ${[...new Set(scene.marks.map((m) => m.say))].join(" ")}`);
    kick();
  });

  function kick() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  // ---- painting ----
  function paint(now: number) {
    frame = 0;
    if (!fit.scale) return;
    const toBoard = (c: CanvasRenderingContext2D) => {
      c.setTransform(dpr * fit.scale, 0, 0, dpr * fit.scale, dpr * fit.x, dpr * fit.y);
    };

    // Finished marks go onto the cache once (all of them again after a resize or a replaced id).
    if (cached.size === 0) {
      cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
      cacheCtx.clearRect(0, 0, cache.width, cache.height);
    }
    toBoard(cacheCtx);
    for (const { mark } of scene.marks) {
      const d = drawn.get(mark.id);
      if (d && d.slot.end <= now && !cached.has(mark.id)) {
        drawInk(cacheCtx, d.ink, 1);
        cached.add(mark.id);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cache, 0, 0);
    toBoard(ctx);

    let busy = false;
    let speaking: string | undefined;
    for (const { mark } of scene.marks) {
      const d = drawn.get(mark.id);
      if (!d || d.slot.end <= now) continue;
      busy = true;
      if (d.slot.start > now) continue;
      const p = (now - d.slot.start) / (d.slot.end - d.slot.start);
      const tip = drawInk(ctx, d.ink, easePen(p));
      if (tip) drawTip(ctx, tip, d.ink.color);
      speaking = d.say;
    }

    // Erased marks: the pen runs backwards until the mark is gone.
    for (const [id, f] of fading) {
      const span = f.slot.end - f.slot.start;
      const p = span > 0 ? (now - f.slot.start) / span : 1;
      if (p >= 1) {
        fading.delete(id);
        continue;
      }
      busy = true;
      drawInk(ctx, f.ink, 1 - easePen(p));
    }

    // The caption: the line being drawn; once the pen rests, the last line, dimmed.
    const line = speaking ?? (busy ? caption.textContent : scene.marks.at(-1)?.say) ?? "";
    if (caption.textContent !== line) caption.textContent = line;
    caption.dataset.state = busy ? "drawing" : "done";

    if (busy) kick();
  }

  // A pen speeds up and slows down a little; it never jumps.
  const easePen = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

  /** Draw a mark up to progress p. Returns where the pen is, if it is mid-mark. */
  function drawInk(c: CanvasRenderingContext2D, ink: Ink, p: number): Pt | undefined {
    let tip: Pt | undefined;
    for (const { part, t } of partsAt(ink, p)) tip = part.kind === "stroke" ? drawStroke(c, part, t, ink.color) : drawText(c, part, t, ink.color);
    return p < 1 ? tip : undefined;
  }

  function drawStroke(c: CanvasRenderingContext2D, part: Extract<Part, { kind: "stroke" }>, t: number, color: string): Pt | undefined {
    const pts = partialPoints(part.points, t);
    const total = part.points.length - 1;
    if (pts.length < 2 || total < 1) return pts[0];
    const minWidth = 1.3 / fit.scale;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = color;

    // Soft glow: the whole stroke once, wide and faint.
    c.globalAlpha = 0.16;
    c.lineWidth = Math.max(part.width, minWidth) * 3.4;
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (const pt of pts) c.lineTo(pt.x, pt.y);
    c.stroke();

    // The ink: segment by segment, thin where the pen lands and lifts.
    c.globalAlpha = 1;
    for (let i = 1; i < pts.length; i++) {
      c.lineWidth = Math.max(part.width * taper(Math.min(i, total) / total), minWidth);
      c.beginPath();
      c.moveTo(pts[i - 1]!.x, pts[i - 1]!.y);
      c.lineTo(pts[i]!.x, pts[i]!.y);
      c.stroke();
    }
    return pts.at(-1);
  }

  function drawText(c: CanvasRenderingContext2D, part: Extract<Part, { kind: "text" }>, t: number, color: string): Pt {
    // Never smaller than about 11 screen pixels, whatever the panel's size.
    c.font = font(Math.max(part.size, 11 / fit.scale));
    c.textBaseline = "middle";
    c.textAlign = "left";
    const width = c.measureText(part.text).width;
    const left = part.align === "center" ? part.x - width / 2 : part.x;
    const h = Math.max(part.size, 11 / fit.scale) * 1.4;
    c.save();
    // Written left to right: show the part of the words the pen has passed.
    c.beginPath();
    c.rect(left - 4, part.y - h / 2, (width + 8) * t, h);
    c.clip();
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 6 * dpr;
    c.fillText(part.text, left, part.y);
    c.restore();
    return { x: left + width * t, y: part.y + h * 0.25 };
  }

  function drawTip(c: CanvasRenderingContext2D, at: Pt, color: string) {
    const r = Math.max(4, 3 / fit.scale);
    c.save();
    c.globalAlpha = 0.28;
    c.fillStyle = color;
    c.beginPath();
    c.arc(at.x, at.y, r * 2.6, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = "#ffffff";
    c.shadowColor = color;
    c.shadowBlur = 10 * dpr;
    c.beginPath();
    c.arc(at.x, at.y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}
