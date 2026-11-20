// Diagram cards (ticket 35, drawing v2): the Mermaid SVG inside each `diagram`
// card. The card's chrome and title are canvas (sketch-view.ts); this layer only
// holds the diagrams, at the body box layout.ts gives the card. Styled like the
// pen: teal lines on dark glass, Martian Mono, square corners.
//
// Mermaid ships inside the app's build (no CDN) and loads on the first card, so
// the window starts as fast as before. `securityLevel: "strict"`: no scripts or
// click handlers from model-written source. A parse error shows in the card,
// with the source under it; it never breaks the window.

import { CELL, ditherCells, photoLum } from "./dither.ts";
import { paintCells } from "./dither-paint.ts";
import { modelLabels, modelSdf, projectPoint, renderModel, type ModelSpec } from "./model3d.ts";

type Mermaid = typeof import("mermaid").default;
let mermaid: Promise<Mermaid> | undefined;

function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      // Ink on the dark teal board, like the pen.
      flowchart: { curve: "basis", padding: 10, nodeSpacing: 34, rankSpacing: 40 },
      themeVariables: {
        darkMode: true,
        background: "transparent",
        primaryColor: "#06201f",
        primaryTextColor: "#dcfff6",
        primaryBorderColor: "#78ffe2",
        secondaryColor: "#082826",
        tertiaryColor: "#082826",
        lineColor: "#78ffe2",
        textColor: "#dcfff6",
        edgeLabelBackground: "#061618",
        clusterBkg: "#04191a",
        clusterBorder: "#0e5c60",
        fontFamily: '"Martian Mono", ui-monospace, monospace',
        fontSize: "12px",
      },
    });
    return m;
  });
  return mermaid;
}

interface Card {
  el: HTMLDivElement;
  source: string;
  render: number;
  /** A dot-matrix body (image and model cards): told its size and whether it shows; stopped when it goes. */
  art?: Art;
}

interface Art {
  size(w: number, h: number, shown: boolean): void;
  stop(): void;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

let renders = 0;

export function mountCards(board: HTMLElement) {
  const layer = Object.assign(document.createElement("div"), { className: "sketch-cards" });
  board.append(layer);
  const cards = new Map<string, Card>();
  // A click on a picture card's body shows the original photo, and a second click the dots
  // again. The card frame above takes the mouse, so the hit is checked by position.
  board.ownerDocument.addEventListener("click", (e) => {
    for (const card of cards.values()) {
      const view = card.el.dataset.view;
      if (view !== "dots" && view !== "photo") continue;
      const r = card.el.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) continue;
      card.el.dataset.view = view === "dots" ? "photo" : "dots";
    }
  });

  async function render(card: Card, source: string) {
    const n = (card.render = ++renders);
    card.el.dataset.state = "drawing";
    card.el.replaceChildren(Object.assign(document.createElement("p"), { className: "sketch-card-note", textContent: "Drawing…" }));
    try {
      const m = await loadMermaid();
      const { svg } = await m.render(`jett-card-${n}`, source);
      if (n !== card.render) return;
      card.el.innerHTML = svg;
      card.el.dataset.state = "ok";
    } catch (err) {
      if (n !== card.render) return;
      const message = err instanceof Error ? err.message : String(err);
      card.el.dataset.state = "error";
      card.el.replaceChildren(
        Object.assign(document.createElement("p"), { className: "sketch-card-error", textContent: `Could not draw this diagram: ${message}` }),
        Object.assign(document.createElement("pre"), { className: "sketch-card-source", textContent: source }),
      );
    }
  }

  const sizes = new Map<string, Promise<{ w: number; h: number } | undefined>>();
  return {
    /**
     * The diagram's natural size in px (from its SVG viewBox), so its card can be sized
     * to its content. Rendered once per source, off screen; undefined if it does not parse.
     */
    sizeOf(source: string): Promise<{ w: number; h: number } | undefined> {
      let size = sizes.get(source);
      if (!size) {
        size = loadMermaid()
          .then((m) => m.render(`jett-size-${++renders}`, source))
          .then(({ svg }) => {
            const box = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([\d.e]+)[ ,]+([\d.e]+)"/);
            return box ? { w: Number(box[3]), h: Number(box[4]) } : undefined;
          })
          .catch(() => undefined);
        sizes.set(source, size);
      }
      return size;
    },
    /** Match the layer to the diagram cards on screen: new ones render, changed sources re-render, gone ones go. */
    sync(items: DiagramBody[]) {
      const live = new Set<string>();
      for (const item of items) {
        live.add(item.id);
        let card = cards.get(item.id);
        if (!card) {
          const el = Object.assign(document.createElement("div"), { className: "sketch-card" });
          el.setAttribute("role", "img");
          layer.append(el);
          card = { el, source: "", render: 0 };
          cards.set(item.id, card);
        }
        // An image card: its picture (a data: URL from the core), or a loading note until it lands.
        const source = item.image ? `image:${item.image.src ?? ""}` : item.model ? `model:${JSON.stringify(item.model)}` : item.source;
        if (card.source !== source) {
          card.source = source;
          card.art?.stop();
          card.art = undefined;
          if (item.image) showImage(card, item.image.src, item.title);
          else if (item.model) showModel(card, item.model);
          else void render(card, item.source);
        }
        const { el } = card;
        el.style.left = `${item.box.x}px`;
        el.style.top = `${item.box.y}px`;
        el.style.width = `${item.box.w}px`;
        el.style.height = `${item.box.h}px`;
        card.art?.size(item.box.w, item.box.h, item.shown);
        const what = item.image ? "Picture" : item.model ? "3D model" : "Diagram";
        el.setAttribute("aria-label", item.title ? `${what}: ${item.title}` : what);
        // The diagram fades in once its card has opened and titled.
        el.dataset.shown = String(item.shown);
      }
      for (const [id, card] of cards) {
        if (live.has(id)) continue;
        cards.delete(id);
        card.render = -1;
        card.art?.stop();
        card.el.dataset.shown = "false";
        setTimeout(() => card.el.remove(), 300);
      }
    },
  };
}

/**
 * An image card's picture, re-drawn as teal dots (dither.ts): fades in from sparse dots, and a
 * click on the card shows the original photo (and back). No src yet = loading.
 */
function showImage(card: Card, src: string | undefined, title?: string) {
  card.render = ++renders;
  delete card.el.dataset.view;
  if (!src) {
    card.el.dataset.state = "drawing";
    card.el.replaceChildren(Object.assign(document.createElement("p"), { className: "sketch-card-note", textContent: "Getting the picture…" }));
    return;
  }
  card.el.dataset.state = "ok";
  card.el.dataset.view = "dots";
  const img = Object.assign(document.createElement("img"), { className: "sketch-card-img", src, alt: title ?? "", draggable: false });
  const canvas = Object.assign(document.createElement("canvas"), { className: "sketch-card-dots" });
  canvas.setAttribute("aria-hidden", "true");
  card.el.replaceChildren(canvas, img);
  card.art = photoArt(canvas, img);
}

/** The photo as dots at the body's size; the reveal starts the first time the card shows. */
function photoArt(canvas: HTMLCanvasElement, img: HTMLImageElement): Art {
  let box = { w: 0, h: 0 };
  let ready = false;
  let shownAt: number | undefined;
  let frame = 0;
  let cells: ReturnType<typeof ditherCells> = [];
  let at = { x: 0, y: 0 };
  const REVEAL_MS = 900;

  function grid() {
    if (!ready || !box.w || !box.h) return;
    const cols = Math.floor(box.w / CELL), rows = Math.floor(box.h / CELL);
    // The picture fits the grid at its own shape, centred.
    const k = Math.min(cols / img.naturalWidth, rows / img.naturalHeight);
    const iw = Math.max(1, Math.round(img.naturalWidth * k)), ih = Math.max(1, Math.round(img.naturalHeight * k));
    const small = Object.assign(document.createElement("canvas"), { width: iw, height: ih });
    const sctx = small.getContext("2d", { willReadFrequently: true })!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(img, 0, 0, iw, ih);
    cells = ditherCells(photoLum(sctx.getImageData(0, 0, iw, ih).data, iw, ih), iw, ih);
    at = { x: Math.floor((box.w - iw * CELL) / 2), y: Math.floor((box.h - ih * CELL) / 2) };
  }

  function paint() {
    frame = 0;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(box.w * dpr) || canvas.height !== Math.round(box.h * dpr)) {
      canvas.width = Math.round(box.w * dpr);
      canvas.height = Math.round(box.h * dpr);
      canvas.style.width = `${box.w}px`;
      canvas.style.height = `${box.h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    if (shownAt === undefined) return;
    const p = reducedMotion() ? 1 : (performance.now() - shownAt) / REVEAL_MS;
    paintCells(ctx, cells, CELL, at.x, at.y, p);
    if (p < 1) frame = requestAnimationFrame(paint);
  }

  img.decode().then(
    () => {
      ready = true;
      grid();
      paint();
    },
    () => {},
  );
  return {
    size(w, h, shown) {
      const resized = w !== box.w || h !== box.h;
      box = { w, h };
      if (shown && shownAt === undefined && ready) shownAt = performance.now();
      if (resized) grid();
      if ((resized || shownAt !== undefined) && !frame) paint();
    },
    stop() {
      cancelAnimationFrame(frame);
      ready = false;
    },
  };
}

/** Degrees a second a model card turns: slow, like a display stand. */
const TURN = (15 * Math.PI) / 180;
const MODEL_FPS = 24;
const BUILD_MS = 750;

/** A model card: the shape in teal dots, built up from sparse dots, then turning slowly with its labels. */
function showModel(card: Card, spec: ModelSpec) {
  card.render = ++renders;
  card.el.dataset.state = "ok";
  card.el.dataset.view = "model";
  const canvas = Object.assign(document.createElement("canvas"), { className: "sketch-card-dots" });
  canvas.setAttribute("aria-hidden", "true");
  card.el.replaceChildren(canvas);
  const sdf = modelSdf(spec);
  const labels = modelLabels(spec);
  let box = { w: 0, h: 0 };
  let shownAt: number | undefined;
  let frame = 0;
  let last = 0;

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    if (shownAt === undefined || now - last < 1000 / MODEL_FPS) return;
    last = now;
    const still = reducedMotion();
    const t = (now - shownAt) / 1000;
    const cols = Math.floor(box.w / CELL), rows = Math.floor(box.h / CELL);
    if (cols < 4 || rows < 4) return;
    const yaw = 0.6 + (still ? 0 : t * TURN);
    const pitch = 0.24 + (still ? 0 : 0.05 * Math.sin(t * 0.9));
    const p = still ? 1 : (now - shownAt) / BUILD_MS;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(box.w * dpr) || canvas.height !== Math.round(box.h * dpr)) {
      canvas.width = Math.round(box.w * dpr);
      canvas.height = Math.round(box.h * dpr);
      canvas.style.width = `${box.w}px`;
      canvas.style.height = `${box.h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const ox = Math.floor((box.w - cols * CELL) / 2), oy = Math.floor((box.h - rows * CELL) / 2);
    paintCells(ctx, ditherCells(renderModel(sdf, cols, rows, yaw, pitch), cols, rows), CELL, ox, oy, p);
    // Labels: bold white mono with a dark edge, pinned to their 3D point; in once it is built.
    const a = Math.max(0, Math.min(1, (p - 0.8) / 0.4));
    if (!a) return;
    ctx.font = '700 10px "Martian Mono", ui-monospace, monospace';
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const l of labels) {
      const at = projectPoint(l, yaw, pitch, cols, rows);
      const x = Math.min(box.w - ctx.measureText(l.text).width - 2, Math.max(2, ox + at.x * CELL + 3)), y = oy + at.y * CELL;
      ctx.globalAlpha = a * (at.front ? 1 : 0.55);
      ctx.strokeStyle = "#031414";
      ctx.lineWidth = 3;
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(l.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
  frame = requestAnimationFrame(tick);
  card.art = {
    size(w, h, shown) {
      box = { w, h };
      if (shown && shownAt === undefined) shownAt = performance.now();
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}

/** A picture's natural size in px, once it decodes; undefined if it does not. */
export function imageSize(src: string): Promise<{ w: number; h: number } | undefined> {
  const img = new Image();
  img.src = src;
  return img.decode().then(
    () => (img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : undefined),
    () => undefined,
  );
}

export interface DiagramBody {
  id: string;
  /** Mermaid source (diagram cards); empty for image cards. */
  source: string;
  /** Set for an image card. */
  image?: { src?: string };
  /** Set for a model card (ticket 42): the shape and its data. */
  model?: ModelSpec;
  title?: string;
  /** Screen px. */
  box: { x: number; y: number; w: number; h: number };
  shown: boolean;
}
