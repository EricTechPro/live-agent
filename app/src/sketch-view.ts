// The drawing on the screen (tickets 32 to 36, drawing v2). Paints the core's
// `canvas.*` marks as HUD cards floating on the desktop, drawn by a glowing pen.
//
//   const sketch = mountSketch(core, stage, { onCaption });
//   sketch.setObstacles([orbRect], "left");   // cards keep clear of these
//   sketch.clearAll();                         // Esc, or the "Clear all · N" chip
//
// Pure parts do the thinking: layout.ts places every card (no overlap, ever),
// motion.ts says how each mark draws step by step, pen.ts paces the marks to the
// voice. This file only paints them on one full-screen canvas, plus a few HTML
// bits: a close button per card, the "Clear all · N" chip, the caption bar and
// Mermaid bodies (card-view.ts).
// Idea from Roamies (AGPL): idea only, our own code.
import { mountCards, type DiagramBody } from "./card-view.ts";
import type { CoreClient } from "./core-client.ts";
import { layoutScene, toScreen, type Layout, type Owned, type PlacedCard, type Prim, type Rect, type Tone } from "./layout.ts";
import { easeInOut, stepAt, typed, unitPlan, type UnitPlan } from "./motion.ts";
import { emptyPen, penAddBeat, penInterrupt, penSpeak, slotOf, VOICE, type Pen } from "./pen.ts";
import { isCard } from "../../src/core/card-kinds.ts";
import { overlayOrigin } from "./screen-origin.ts";
import { addCanvasEvent, emptyScene, INK_COLORS, partialPoints, type Pt, type Scene } from "./sketch.ts";
import type { Slot } from "./sketch.ts";

/** The look (drawing v2). */
export const LOOK = {
  acc: "#78ffe2",
  hot: "#e6fffa",
  mid: "#28c4b8",
  deep: "#0e5c60",
  glass: "rgba(6,22,24,0.94)",
  text: "#dcfff6",
  dim: "#8ab8b0",
  edge: "rgba(3,39,34,0.6)",
} as const;
const FONT = '"Martian Mono", ui-monospace, monospace';
/** Doto, the dot-matrix display face, for headings. */
const DISPLAY = '"Doto", "Martian Mono", ui-monospace, monospace';
const LEAVE_MS = 250;
/** The caption stays this long after the beat's last mark. */
const CAPTION_HOLD_MS = 1800;
/** The pen tip lingers this long after the last mark. */
const TIP_HOLD_MS = 600;

interface Unit {
  plan: UnitPlan;
  /** Card id it is drawn in (card-local coords), or undefined for screen px. */
  card?: string;
  /** This unit opens its card. */
  opens?: boolean;
  prims: Prim[];
}

interface Leaving {
  card: PlacedCard;
  at: number;
}

export interface SketchApi {
  clearAll(): void;
  openCount(): number;
  setObstacles(rects: Rect[], from?: "left" | "right"): void;
  captionActive(): boolean;
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function mountSketch(core: Pick<CoreClient, "onEvent">, host: HTMLElement, opts: { onCaption?: (active: boolean) => void } = {}): SketchApi {
  const canvas = Object.assign(document.createElement("canvas"), { className: "sketch-ink" });
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Drawing");
  const ui = Object.assign(document.createElement("div"), { className: "sketch-ui" });
  const caption = Object.assign(document.createElement("div"), { className: "sketch-caption", hidden: true });
  caption.setAttribute("aria-live", "polite");
  const captionText = document.createElement("p");
  caption.append(captionText);
  const clearBtn = Object.assign(document.createElement("button"), { className: "sketch-clear", type: "button", hidden: true });
  clearBtn.dataset.hit = "";
  clearBtn.onclick = () => api.clearAll();
  const cardsLayer = mountCards(ui);
  ui.append(clearBtn, caption);
  host.append(canvas, ui);
  const ctx = canvas.getContext("2d")!;

  let scene: Scene = emptyScene;
  let closed = new Set<string>();
  let layout: Layout = { cards: [], screen: [], evicted: [] };
  let prev = new Map<string, Rect & { scale: number }>();
  let units = new Map<string, Unit>();
  let leaving: Leaving[] = [];
  /** Marks that arrived but whose pen time has not come: not on screen yet, so they take no room. */
  let waiting = new Set<string>();
  let pen: Pen = emptyPen;
  let beats: { key: string; say: string; ids: string[] }[] = [];
  let obstacles: Rect[] = [];
  let from: "left" | "right" = "left";
  let charW: number | undefined;
  let displayW: number | undefined;
  /** Rendered Mermaid sizes by card id: diagram cards fit their content. */
  const diagrams = new Map<string, { w: number; h: number }>();
  let dpr = 1;
  let frame = 0;
  let captionOn = false;
  const closeBtns = new Map<string, HTMLButtonElement>();

  // ---- size and font ----
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    relayout();
  }
  addEventListener("resize", resize);
  resize();
  // Measure the real monospace advance once the font is in, so layout's text boxes are exact.
  void Promise.all([document.fonts?.load(`400 13px ${FONT}`), document.fonts?.load(`800 19px ${DISPLAY}`)]).then(() => {
    ctx.font = `400 100px ${FONT}`;
    charW = ctx.measureText("0123456789").width / 1000;
    ctx.font = `800 100px ${DISPLAY}`;
    displayW = ctx.measureText("Inside a black hole").width / 1900;
    relayout();
  });

  // ---- layout and plans ----
  function relayout() {
    const view = { width: innerWidth, height: innerHeight };
    // The caption bar and the clear chip sit bottom centre: cards keep off them too.
    const bottomBand = { x: view.width / 2 - 320, y: view.height - 104, w: 640, h: 104 };
    const before = new Map(layout.cards.map((c) => [c.id, c]));
    const now0 = performance.now();
    // A waiting mark joins the layout once the pen has a time for it and that time has come.
    // Ink on a card, and the loose marks of one sketch, join with their card, so a card's
    // size is settled when it opens (each mark still draws at its own time).
    const due = (id: string) => !waiting.has(id) || (slotOf(pen, id)?.start ?? Infinity) <= now0;
    const group = (m: (typeof scene.marks)[number]) => {
      const r = m.mark as { on?: string; to_card?: string };
      if (r.to_card || m.mark.kind === "spot") return m.mark.id;
      if (r.on) return r.on;
      return isCard(m.mark) ? m.mark.id : `sketch:${m.beatKey.split(":")[0]}`;
    };
    const live = new Set(scene.marks.filter((m) => due(m.mark.id)).map(group));
    const shown = scene.marks.filter((m) => due(m.mark.id) || live.has(group(m)));
    for (const m of shown) waiting.delete(m.mark.id);
    layout = layoutScene({ marks: shown, view, obstacles: [...obstacles, bottomBand], prev, closed, from, charW, displayW, diagrams, origin: overlayOrigin() });
    prev = new Map(layout.cards.map((c) => [c.id, { ...c.rect, scale: c.scale }]));
    // Cards that went (closed, evicted, erased) fade out.
    const now = performance.now();
    for (const [id, card] of before) if (!prev.has(id) && cardStarted(card, now)) leaving.push({ card, at: now });
    units = buildUnits(layout);
    host.dataset.view = layout.cards.length || layout.screen.length || leaving.length ? "sketch" : "";
    if (!host.dataset.view) delete host.dataset.view;
    syncUi(now);
    kick();
  }

  function buildUnits(l: Layout): Map<string, Unit> {
    const out = new Map<string, Unit>();
    for (const card of l.cards) {
      const map = (p: Pt) => ({ x: card.rect.x + p.x * card.scale, y: card.rect.y + p.y * card.scale });
      const byOwner = new Map<string, Prim[]>();
      for (const o of card.prims) byOwner.set(o.owner, [...(byOwner.get(o.owner) ?? []), o.prim]);
      card.owners.forEach((owner, i) => {
        // A mark card opens with its own unit; a sketch card opens with its first mark.
        const opens = owner === card.id || (card.kind === "sketch" && i === 0);
        const prims = byOwner.get(owner) ?? [];
        out.set(owner, { plan: unitPlan(prims, map, opens ? { rect: card.rect } : undefined), card: card.id, opens, prims });
      });
    }
    const byOwner = new Map<string, Prim[]>();
    for (const o of l.screen) byOwner.set(o.owner, [...(byOwner.get(o.owner) ?? []), o.prim]);
    for (const [owner, prims] of byOwner) out.set(owner, { plan: unitPlan(prims, (p) => p), prims });
    return out;
  }

  /** When a mark draws; marks the pen has forgotten are long done. */
  const slot = (id: string): Slot => slotOf(pen, id) ?? { start: -Infinity, end: -Infinity };
  const openerOf = (card: PlacedCard) => (card.kind === "sketch" ? card.owners[0]! : card.id);
  const cardStarted = (card: PlacedCard, now: number) => slot(openerOf(card)).start <= now;

  // ---- events ----
  core.onEvent((event) => {
    if (event.type !== "chat.started" && event.type !== "interrupted" && !event.type.startsWith("canvas.")) return;
    const now = performance.now();
    const reduced = reducedMotion();
    if (event.type === "interrupted") {
      // The user talked over Jett: the pen stops; beats not yet spoken stay undrawn.
      const stopped = penInterrupt(pen, now);
      pen = stopped.pen;
      for (const id of stopped.dropped) waiting.delete(id);
      if (stopped.dropped.length) scene = addCanvasEvent(scene, { type: "canvas.erase", id: "", ids: stopped.dropped, all: false });
      relayout();
      return;
    }
    scene = addCanvasEvent(scene, event);
    if (event.type === "chat.started") {
      pen = emptyPen;
      beats = [];
      closed = new Set();
      waiting = new Set();
      relayout();
      return;
    }
    if (event.type === "canvas.speak") {
      pen = penSpeak(pen, `${event.id}:${event.beat}`, now, reduced);
      kick();
      return;
    }
    if (event.type === "canvas.beat") for (const m of event.marks) waiting.add(m.id);
    // Diagram cards: measure the rendered Mermaid, then lay the card out to fit it.
    const drawnMarks = event.type === "canvas.beat" ? event.marks : event.type === "canvas.edit" ? [event.mark] : [];
    for (const m of drawnMarks)
      if (m.kind === "diagram")
        void cardsLayer.sizeOf(m.source).then((size) => {
          if (!size) return;
          diagrams.set(m.id, size);
          relayout();
        });
    relayout();
    if (event.type === "canvas.edit") {
      // The changed mark redraws at once.
      const u = units.get(event.mark.id);
      pen = penAddBeat(pen, { key: `edit:${event.mark.id}:${now}`, say: "", ids: [event.mark.id], durations: [u?.plan.total ?? 0] }, now, reduced);
      return kick();
    }
    if (event.type !== "canvas.beat") return;
    const key = `${event.id}:${event.beat}`;
    const ids = event.marks.map((m) => m.id);
    // How long each new mark takes, from a layout with everything in it (only sizes matter here).
    const all = buildUnits(layoutScene({ marks: scene.marks, view: { width: innerWidth, height: innerHeight }, closed, charW, displayW, diagrams, max: Infinity, origin: overlayOrigin() }));
    pen = penAddBeat(pen, { key, say: event.say, ids, durations: ids.map((id) => all.get(id)?.plan.total ?? 0) }, now, reduced);
    relayout();
    beats = [...beats.filter((b) => b.key !== key), { key, say: event.say, ids }];
    canvas.setAttribute("aria-label", `Drawing: ${beats.map((b) => b.say).join(" ")}`);
    kick();
  });

  function kick() {
    if (!frame) frame = requestAnimationFrame(paint);
  }

  // ---- HTML bits: close buttons, the clear chip, the caption, Mermaid bodies ----
  function syncUi(now: number) {
    const live = new Set<string>();
    const bodies: DiagramBody[] = [];
    for (const card of layout.cards) {
      const s = slot(openerOf(card));
      const open = s.start <= now && stepAt(units.get(openerOf(card))!.plan, s, now).index >= 1;
      live.add(card.id);
      let btn = closeBtns.get(card.id);
      if (!btn) {
        btn = Object.assign(document.createElement("button"), { className: "sketch-x", type: "button" });
        btn.dataset.hit = "";
        btn.setAttribute("aria-label", `Close ${card.title}`);
        const id = card.id;
        btn.onclick = () => {
          closed.add(id);
          relayout();
        };
        ui.append(btn);
        closeBtns.set(card.id, btn);
      }
      btn.hidden = !open;
      btn.style.left = `${card.rect.x + card.rect.w - 24}px`;
      btn.style.top = `${card.rect.y + 2}px`;
      const mark = scene.marks.find((m) => m.mark.id === card.id)?.mark;
      if (mark?.kind === "diagram" && card.body) {
        const titled = s.start <= now && stepAt(units.get(card.id)!.plan, s, now).index >= 3;
        bodies.push({ id: card.id, source: mark.source, title: mark.title, box: toScreen(card.body, card), shown: titled });
      }
    }
    for (const [id, btn] of closeBtns) {
      if (live.has(id)) continue;
      btn.remove();
      closeBtns.delete(id);
    }
    cardsLayer.sync(bodies);
    const n = layout.cards.filter((c) => cardStarted(c, now)).length;
    clearBtn.hidden = n < 2;
    clearBtn.textContent = `Clear all · ${n}`;
  }

  /** The line being drawn now: the latest beat that has started, until a moment after its last mark. */
  function currentLine(now: number): string | undefined {
    for (let i = beats.length - 1; i >= 0; i--) {
      const b = beats[i]!;
      const slots = b.ids.map((id) => slotOf(pen, id)).filter((s): s is Slot => !!s);
      if (!slots.length) continue;
      const start = Math.min(...slots.map((s) => s.start));
      const end = Math.max(...slots.map((s) => s.end), start + (b.say ? 0 : 0));
      if (start <= now) return now <= Math.max(end, start + VOICE.minBeatMs) + CAPTION_HOLD_MS ? b.say : undefined;
    }
    return undefined;
  }

  // ---- painting ----
  function paint(now: number) {
    frame = 0;
    // A waiting mark's time has come: it joins the layout (and takes its room) now.
    if ([...waiting].some((id) => (slotOf(pen, id)?.start ?? Infinity) <= now)) relayout();
    if (waiting.size) kick();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let busy = false;

    // Cards leaving: fade out, fully drawn.
    leaving = leaving.filter((l) => now - l.at < LEAVE_MS);
    for (const l of leaving) {
      busy = true;
      ctx.save();
      ctx.globalAlpha = 1 - (now - l.at) / LEAVE_MS;
      drawCard(l.card, now, true);
      ctx.restore();
    }

    for (const card of layout.cards) if (drawCard(card, now, false)) busy = true;

    // Ink in screen px (arrows between cards; later, marks on real UI).
    const screenOwners = [...new Set(layout.screen.map((o) => o.owner))];
    for (const owner of screenOwners) {
      const u = units.get(owner);
      if (!u) continue;
      const s = slot(owner);
      if (s.start > now) {
        busy = true;
        continue;
      }
      if (s.end > now) busy = true;
      drawUnit(u, s, now, true);
    }

    // The pen tip: on the mark it is drawing, or flying to the next one.
    const tip = penTip(now);
    if (tip) {
      busy = true;
      drawTip(tip.at, tip.alpha, now);
    }

    const line = currentLine(now);
    if (line !== undefined) busy = true;
    const on = line !== undefined && line.length > 0;
    if (on && captionText.textContent !== line) captionText.textContent = line;
    caption.hidden = !on;
    if (on !== captionOn) {
      captionOn = on;
      opts.onCaption?.(on);
    }
    syncUi(now);
    if (!layout.cards.length && !layout.screen.length && !leaving.length) delete host.dataset.view;
    if (busy) kick();
  }

  /** Draw one card and the ink on it. Returns true while it is still animating. */
  function drawCard(card: PlacedCard, now: number, done: boolean): boolean {
    const opener = units.get(openerOf(card));
    const s = done ? { start: -Infinity, end: -Infinity } : slot(openerOf(card));
    if (s.start > now) return true;
    const st = opener && !done ? stepAt(opener.plan, s, now) : { index: Infinity, t: 1 };
    const openT = st.index > 0 ? 1 : easeInOut(st.t);
    const titleT = st.index > 2 ? 1 : st.index === 2 ? st.t : 0;
    const { x, y } = card.rect;
    const k = card.scale;
    const w = card.rect.w * openT;
    const h = card.rect.h * openT;
    if (w < 4 || h < 4) return true;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    chrome(w / k, h / k, card.title, titleT);
    ctx.restore();
    if (st.index < 3 && !done) return true;
    // Contents: every unit drawn in this card, in owner order.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, card.rect.w, card.rect.h);
    ctx.clip();
    let busy = false;
    for (const owner of card.owners) {
      const u = units.get(owner);
      if (!u) continue;
      const us = done ? { start: -Infinity, end: -Infinity } : slot(owner);
      if (us.start > now) {
        busy = true;
        continue;
      }
      if (us.end > now) busy = true;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(k, k);
      drawUnit(u, us, now, false, cardColor(card));
      ctx.restore();
    }
    ctx.restore();
    return busy || s.end > now;
  }

  const cardColor = (card: PlacedCard) => (card.color ? INK_COLORS[card.color as keyof typeof INK_COLORS] : LOOK.acc);

  /** Draw a unit's prims up to `now`. Coordinates are already set up by the caller. */
  function drawUnit(u: Unit, s: Slot, now: number, screen: boolean, ink: string = LOOK.acc) {
    const st = stepAt(u.plan, s, now);
    let primIndex = 0;
    u.plan.steps.forEach((step, i) => {
      if (step.kind !== "prim") return;
      primIndex++;
      if (i > st.index) return;
      const t = i < st.index ? 1 : st.t;
      if (t <= 0) return;
      drawPrim(step.prim, t, screen, ink);
    });
    void primIndex;
  }

  function toneColor(tone: Tone, ink: string): string {
    if (tone === "wash") return "rgba(120,255,226,0.30)";
    return tone === "ink" ? ink : tone === "text" ? LOOK.text : tone === "dim" ? LOOK.dim : tone === "hot" ? LOOK.hot : LOOK.deep;
  }

  function drawPrim(p: Prim, t: number, screen: boolean, ink: string) {
    if (p.t === "stroke" && p.tone === "wash") return drawWash(p.pts, p.width, t);
    if (p.t === "stroke") return drawStroke(p.pts, p.width, toneColor(p.tone, ink), t);
    if (p.t === "text" && p.chip) return drawChip(p, t, ink);
    if (p.t === "dot") {
      const r = p.r * (t >= 1 ? 1 : 0.4 + 0.9 * Math.sin((t * Math.PI) / 1.6));
      ctx.save();
      ctx.fillStyle = LOOK.edge;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = ink;
      ctx.shadowBlur = 10;
      ctx.fillStyle = toneColor(p.tone, ink);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    drawText(p, t, screen, ink);
  }

  function drawStroke(pts: Pt[], width: number, color: string, t: number) {
    const part = partialPoints(pts, t);
    if (part.length < 2) return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(part[0]!.x, part[0]!.y);
      for (const q of part) ctx.lineTo(q.x, q.y);
    };
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Dark edge under the ink so it reads on a white page too.
    ctx.strokeStyle = LOOK.edge;
    ctx.lineWidth = width + 3;
    path();
    ctx.stroke();
    // The ink, with a soft glow.
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // The wet leading edge burns bright while the pen is on it.
    if (t < 1 && part.length > 2) {
      const tail = part.slice(-Math.min(part.length, 4));
      ctx.strokeStyle = LOOK.hot;
      ctx.lineWidth = Math.max(1.5, width * 0.55);
      ctx.beginPath();
      ctx.moveTo(tail[0]!.x, tail[0]!.y);
      for (const q of tail) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A marker pass over real words (screen highlight): see-through, no dark edge, flat ends. */
  function drawWash(pts: Pt[], width: number, t: number) {
    const part = partialPoints(pts, t);
    if (part.length < 2) return;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(120,255,226,0.26)";
    ctx.shadowColor = "rgba(120,255,226,0.55)";
    ctx.shadowBlur = 10;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(part[0]!.x, part[0]!.y);
    for (const q of part) ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.restore();
  }

  /** A label chip on real UI: a glowing filled tag with stepped corners, dark heavy words typed in. */
  function drawChip(p: Prim & { t: "text" }, t: number, ink: string) {
    const pad = { x: 8, y: 4 };
    const b = { x: p.box.x - pad.x, y: p.box.y - pad.y, w: p.box.w + pad.x * 2, h: p.box.h + pad.y * 2 };
    const grow = Math.min(1, t * 3); // the tag snaps open, then the words type
    const w = b.w * easeInOut(grow);
    const c = 3;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(b.x + c, b.y);
    ctx.lineTo(b.x + w - c, b.y);
    ctx.lineTo(b.x + w, b.y + c);
    ctx.lineTo(b.x + w, b.y + b.h - c);
    ctx.lineTo(b.x + w - c, b.y + b.h);
    ctx.lineTo(b.x + c, b.y + b.h);
    ctx.lineTo(b.x, b.y + b.h - c);
    ctx.lineTo(b.x, b.y + c);
    ctx.closePath();
    ctx.shadowColor = ink;
    ctx.shadowBlur = 14;
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = LOOK.hot;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (grow >= 1) {
      const shown = typed(p.lines, Math.min(1, (t - 1 / 3) * 1.5));
      ctx.font = `${p.weight} ${p.size}px ${FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#03211f";
      ctx.fillText(shown.lines[0] ?? "", p.box.x, p.box.y + p.box.h / 2 + 0.5);
    }
    ctx.restore();
  }

  function drawText(p: Prim & { t: "text" }, t: number, screen: boolean, ink: string) {
    const shown = typed(p.lines, t);
    if (!shown.lines.length) return;
    const lineH = p.size * 1.38;
    ctx.save();
    ctx.font = `${p.weight} ${p.size}px ${p.font === "display" ? DISPLAY : FONT}`;
    ctx.textBaseline = "middle";
    const color = toneColor(p.tone, ink);
    const total = shown.lines.reduce((n, l) => n + l.length, 0);
    let seen = 0;
    shown.lines.forEach((text, i) => {
      const full = p.lines[i]!;
      const fullW = ctx.measureText(full).width;
      const left = p.align === "left" ? p.box.x : p.align === "center" ? p.box.x + (p.box.w - fullW) / 2 : p.box.x + p.box.w - fullW;
      const y = p.box.y + lineH * i + lineH / 2;
      // The last characters typed land white, then settle.
      const hotFrom = Math.max(0, total - shown.hot - seen);
      const cool = text.slice(0, Math.min(text.length, hotFrom));
      const hot = text.slice(cool.length);
      if (screen) {
        ctx.strokeStyle = "rgba(2,12,14,0.85)";
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.strokeText(text, left, y);
      }
      if (p.tone === "ink") {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
      }
      ctx.fillStyle = color;
      ctx.fillText(cool, left, y);
      if (hot) {
        ctx.fillStyle = LOOK.hot;
        ctx.shadowColor = LOOK.hot;
        ctx.shadowBlur = 8;
        ctx.fillText(hot, left + ctx.measureText(cool).width, y);
        ctx.shadowBlur = 0;
      }
      seen += text.length;
    });
    ctx.restore();
  }

  /** The HUD window: stepped corners, dark glass, glowing teal border, a glint, the title bar. */
  function chrome(w: number, h: number, title: string, titleT: number) {
    const s = 3;
    const path = () => {
      ctx.beginPath();
      const pts: [number, number][] = [
        [2 * s, 0], [w - 2 * s, 0], [w - 2 * s, s], [w - s, s], [w - s, 2 * s], [w, 2 * s],
        [w, h - 2 * s], [w - s, h - 2 * s], [w - s, h - s], [w - 2 * s, h - s], [w - 2 * s, h],
        [2 * s, h], [2 * s, h - s], [s, h - s], [s, h - 2 * s], [0, h - 2 * s],
        [0, 2 * s], [s, 2 * s], [s, s], [2 * s, s],
      ];
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = LOOK.glass;
    path();
    ctx.fill();
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = LOOK.acc;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = LOOK.acc;
    ctx.lineWidth = 1.5;
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    // A short glint along the top-left edge.
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(2 * s + 3, 2);
    ctx.lineTo(2 * s + 3 + Math.min(90, w * 0.35), 2);
    ctx.stroke();
    if (h >= 30) {
      // Title bar: two little squares, the title, the close ×, a divider.
      ctx.fillStyle = LOOK.acc;
      ctx.fillRect(10, 11, 4, 4);
      ctx.fillStyle = LOOK.deep;
      ctx.fillRect(17, 11, 4, 4);
      ctx.fillStyle = LOOK.deep;
      ctx.fillRect(1.5, 26, w - 3, 1);
      if (w > 60) {
        ctx.strokeStyle = LOOK.dim;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w - 17, 9);
        ctx.lineTo(w - 10, 16);
        ctx.moveTo(w - 10, 9);
        ctx.lineTo(w - 17, 16);
        ctx.stroke();
      }
      if (titleT > 0) {
        const shown = typed([title], titleT);
        const text = shown.lines[0] ?? "";
        ctx.font = `500 10px ${FONT}`;
        ctx.textBaseline = "middle";
        const fullW = ctx.measureText(title).width;
        const left = (w - fullW) / 2;
        const cool = text.slice(0, text.length - shown.hot);
        ctx.fillStyle = LOOK.dim;
        ctx.fillText(cool, left, 13.5);
        if (shown.hot) {
          ctx.fillStyle = LOOK.hot;
          ctx.fillText(text.slice(cool.length), left + ctx.measureText(cool).width, 13.5);
        }
      }
      // A pixel resize grip in the corner.
      ctx.fillStyle = LOOK.deep;
      for (const [gx, gy] of [[w - 8, h - 5], [w - 5, h - 8], [w - 5, h - 5]] as const) ctx.fillRect(gx, gy, 2, 2);
    }
    ctx.restore();
  }

  /** Where the pen is now: on a mark, flying between two, or resting a moment after the last. */
  function penTip(now: number): { at: Pt; alpha: number } | undefined {
    let lastEnd = -Infinity;
    let lastAt: Pt | undefined;
    let next: { start: number; at: Pt } | undefined;
    for (const [id, u] of units) {
      const s = slotOf(pen, id);
      if (!s || !u.plan.steps.length) continue;
      if (s.start <= now && now < s.end) return { at: stepAt(u.plan, s, now).pen, alpha: 1 };
      if (s.end <= now && s.end > lastEnd) (lastEnd = s.end), (lastAt = u.plan.end);
      if (s.start > now && (!next || s.start < next.start)) next = { start: s.start, at: u.plan.start };
    }
    if (lastAt && next) {
      const t = (now - lastEnd) / Math.max(1, next.start - lastEnd);
      const e = easeInOut(Math.min(1, Math.max(0, t)));
      return { at: { x: lastAt.x + (next.at.x - lastAt.x) * e, y: lastAt.y + (next.at.y - lastAt.y) * e }, alpha: 1 };
    }
    if (lastAt && now - lastEnd < TIP_HOLD_MS) return { at: lastAt, alpha: 1 - (now - lastEnd) / TIP_HOLD_MS };
    return undefined;
  }

  /** The pen: a small dotted reticle with a bright core, turning slowly. */
  function drawTip(at: Pt, alpha: number, now: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(at.x, at.y);
    ctx.shadowColor = LOOK.acc;
    ctx.shadowBlur = 8;
    ctx.fillStyle = LOOK.acc;
    const spin = now / 900;
    for (let i = 0; i < 12; i++) {
      const a = spin + (i / 12) * Math.PI * 2;
      const r = 13 + (i % 3 === 0 ? 3 : 0);
      ctx.fillRect(Math.cos(a) * r - 1.25, Math.sin(a) * r - 1.25, 2.5, 2.5);
    }
    ctx.fillStyle = LOOK.hot;
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }

  const api: SketchApi = {
    clearAll() {
      for (const c of layout.cards) closed.add(c.id);
      relayout();
    },
    openCount: () => layout.cards.length,
    setObstacles(rects, side = "left") {
      const same = side === from && rects.length === obstacles.length && rects.every((r, i) => {
        const o = obstacles[i]!;
        return o.x === r.x && o.y === r.y && o.w === r.w && o.h === r.h;
      });
      if (same) return;
      obstacles = rects;
      from = side;
      relayout();
    },
    captionActive: () => captionOn,
  };
  return api;
}

export type { Owned };
