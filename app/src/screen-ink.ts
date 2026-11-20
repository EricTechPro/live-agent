// Screen awareness in the window (slice 2): the user's ink while Ctrl+Option is held, and
// the "Screen Recording is off" and "Accessibility is off" (slice 3) notices. Its own layer and module, apart from the sketch
// renderer, so the drawing work can change freely.
//
// While talking (the draw keys held, Ctrl+Option by default), the pointer path is drawn on a
// see-through layer, no clicking: a smoothed mint line with a dark edge (ink-stroke.ts), and the
// listening pill rides the pointer. It stays while you talk and fades 0.5 s after release.
// When Jett answers a circle, a ghost orb in dots forms on the circled spot with the answer in
// a bubble beside it (ticket 43).
// The moment the ink closes, the path goes to the core (POST /screen/circle), which checks the
// loop with the same code (src/screen/geometry.ts) and sends the circled crop to the model.
// On release, POST /screen/release adds the words for the turn.
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../../src/core/events.ts";
import { joinText } from "../../src/core/join-text.ts";
import { findLoop, type Pt } from "../../src/screen/geometry.ts";
import { ditherCells } from "./dither.ts";
import { paintCells } from "./dither-paint.ts";
import { GHOST, INK, ghostPlace, loopCentre, pillRect, smooth } from "./ink-stroke.ts";
import { modelSdf, renderModel } from "./model3d.ts";

type CoreInfo = { url: string; launchToken: string };
type Pointer = { x: number; y: number; originX: number; originY: number };

const TEAL = "#2dd4bf";
/** Pointer poll while the keys are held: ~60 a second for a smooth line. */
const POLL_MS = 16;
/** Points closer than this (pt) to the last one are skipped. */
const MIN_STEP = 2;

export interface ScreenInk {
  /** Ctrl+Option started a talk: start drawing the pointer path. */
  start(): void;
  /** The keys were let go: stop, send the path, fade the ink. */
  finish(): void;
  /** Watch the core's events (Screen Recording off shows the notice). */
  onEvent(event: AgentEvent): void;
}

export interface ScreenInkOptions {
  /** The mic level now, 0..1: the pointer pill's bars bounce with it. */
  level?: () => number;
}

/** How long after the loop closes an answer still counts as about it (ms). */
const ANSWER_WINDOW_MS = 25_000;
/** The ghost orb stays this long after the answer ends (ms). */
const GHOST_HOLD_MS = 3500;

export function createScreenInk(info: CoreInfo, options: ScreenInkOptions = {}): ScreenInk {
  const auth = { Authorization: `Bearer ${info.launchToken}`, "Content-Type": "application/json" };
  const canvas = document.createElement("canvas");
  canvas.id = "screen-ink";
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100vw", height: "100vh",
    pointerEvents: "none", zIndex: "2147483000", opacity: "0", transition: "opacity 400ms ease",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  let stroke: Pt[] = [];
  let origin = { x: 0, y: 0 };
  let timer: ReturnType<typeof setInterval> | undefined;
  let startedAt = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (stroke.length >= 2) {
      // Global points -> this window's CSS pixels: subtract the window's own origin.
      const pts = smooth(stroke).map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = INK.alpha;
      for (const [color, width] of [[INK.edge, INK.edgeWidth], [INK.core, INK.width]] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // The listening pill rides the pointer while drawing, over the line.
    const tip = stroke.at(-1);
    if (timer && tip) drawPill({ x: tip.x - origin.x, y: tip.y - origin.y });
  }

  /** A small dark pill with a mint edge; seven bars bounce with the mic, each a little behind the last. */
  function drawPill(at: Pt) {
    const r = pillRect(at);
    ctx.fillStyle = "rgba(3, 23, 22, 0.9)";
    ctx.strokeStyle = "#78ffe2";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fill();
    ctx.stroke();
    const level = Math.min(1, (options.level?.() ?? 0) * 3);
    const t = performance.now() / 1000;
    ctx.fillStyle = "#a8ffed";
    for (let i = 0; i < 7; i++) {
      const wiggle = 0.5 + 0.5 * Math.sin(t * 11 + i * 1.7);
      const h = 2 + (r.h - 6) * level * (0.45 + 0.55 * wiggle);
      ctx.fillRect(r.x + 7 + i * 3.4, r.y + (r.h - h) / 2, 2, h);
    }
  }

  async function sample() {
    const at = await invoke<Pointer | null>("pointer_global").catch(() => null);
    if (!at || !timer) return;
    origin = { x: at.originX, y: at.originY };
    const last = stroke.at(-1);
    if (last && Math.hypot(at.x - last.x, at.y - last.y) < MIN_STEP) return;
    stroke.push({ x: at.x, y: at.y });
    const loop = !closed && stroke.length >= 8 ? findLoop(stroke) : undefined;
    if (loop) {
      closed = true;
      // An answer from here on is about this circle: the ghost orb lands on it.
      answerFor = { centre: loopCentre(loop), until: Date.now() + ANSWER_WINDOW_MS };
      // Send the crop now, while the question is still being spoken, so it is in before it ends.
      void fetch(`${info.url}/screen/circle`, { method: "POST", headers: auth, body: JSON.stringify({ stroke }) }).catch(() => {});
    }
    draw();
  }

  function start() {
    clearTimeout(fadeTimer);
    hideGhost(true);
    answerFor = undefined;
    stroke = [];
    closed = false;
    startedAt = performance.now();
    canvas.style.transition = "none";
    canvas.style.opacity = "1";
    draw();
    clearInterval(timer);
    timer = setInterval(() => void sample(), POLL_MS);
  }

  function finish() {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
    draw(); // the pill goes with the keys
    const path = stroke.length > 1500 ? stroke.filter((_, k) => k % Math.ceil(stroke.length / 1500) === 0) : stroke;
    const body = { stroke: path, cursor: stroke.at(-1), holdMs: Math.round(performance.now() - startedAt) };
    void fetch(`${info.url}/screen/release`, { method: "POST", headers: auth, body: JSON.stringify(body) }).catch(() => {});
    // The ink stayed up while you talked; now it fades.
    canvas.style.transition = `opacity ${INK.fadeMs}ms ease`;
    canvas.style.opacity = "0";
    fadeTimer = setTimeout(draw, INK.fadeMs);
  }

  // ---- the ghost orb: the answer to a circle, on the circled spot (ticket 43) ----
  let answerFor: { centre: Pt; until: number } | undefined;
  const ghost = document.createElement("div");
  ghost.className = "ink-ghost";
  ghost.hidden = true;
  const ghostDots = Object.assign(document.createElement("canvas"), { className: "ink-ghost-orb" });
  ghostDots.setAttribute("aria-hidden", "true");
  const bubble = Object.assign(document.createElement("p"), { className: "ink-ghost-bubble" });
  bubble.setAttribute("aria-live", "polite");
  ghost.append(ghostDots, bubble);
  document.body.appendChild(ghost);
  const BUBBLE_W = 320;
  let ghostText = "";
  let ghostAt = 0;
  let ghostFrame = 0;
  let ghostTimer: ReturnType<typeof setTimeout> | undefined;
  const sphere = modelSdf({ shape: "sphere" });
  const DOTS = 24;
  const DOT = GHOST.size / DOTS;

  function showGhost(centre: Pt) {
    const local = { x: centre.x - origin.x, y: centre.y - origin.y };
    const place = ghostPlace(local, { width: innerWidth, height: innerHeight }, BUBBLE_W);
    Object.assign(ghostDots.style, { left: `${place.orb.x}px`, top: `${place.orb.y}px`, width: `${GHOST.size}px`, height: `${GHOST.size}px` });
    Object.assign(bubble.style, { left: `${place.bubble.x}px`, top: `${place.bubble.y}px`, maxWidth: `${BUBBLE_W}px` });
    bubble.dataset.side = place.side;
    ghostText = "";
    bubble.textContent = "";
    ghostAt = performance.now();
    ghost.hidden = false;
    ghost.dataset.on = "true";
    cancelAnimationFrame(ghostFrame);
    ghostFrame = requestAnimationFrame(paintGhost);
  }

  /** Dots fly in to a see-through sphere (the circled thing shows between them), then shimmer. */
  function paintGhost(now: number) {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(GHOST.size * dpr);
    if (ghostDots.width !== px) ghostDots.width = ghostDots.height = px;
    const g = ghostDots.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, GHOST.size, GHOST.size);
    const t = (now - ghostAt) / 1000;
    const lum = renderModel(sphere, DOTS, DOTS, t * 0.6, 0.3);
    // A soft shimmer while it speaks: brightness ripples out from the middle.
    for (let i = 0; i < lum.length; i++)
      if (lum[i]) lum[i] = Math.min(1, lum[i]! * (0.9 + 0.15 * Math.sin(t * 6 - Math.hypot((i % DOTS) - DOTS / 2, Math.floor(i / DOTS) - DOTS / 2) * 0.7)));
    g.globalAlpha = 0.75;
    paintCells(g, ditherCells(lum, DOTS, DOTS), DOT, 0, 0, Math.min(1, t / 0.5));
    if (!ghost.hidden) ghostFrame = requestAnimationFrame(paintGhost);
  }

  function hideGhost(now = false) {
    clearTimeout(ghostTimer);
    if (ghost.hidden) return;
    ghost.dataset.on = "false";
    const done = () => {
      ghost.hidden = true;
      cancelAnimationFrame(ghostFrame);
    };
    if (now) done();
    else ghostTimer = setTimeout(done, 300);
  }

  function onAnswer(event: AgentEvent) {
    if (event.type === "transcript" && event.role === "model") {
      if (ghost.hidden && answerFor && Date.now() < answerFor.until) {
        showGhost(answerFor.centre);
        answerFor = undefined;
      }
      if (ghost.hidden) return;
      clearTimeout(ghostTimer);
      ghostText = joinText(ghostText, event.text);
      bubble.textContent = ghostText;
    } else if (event.type === "turn.done" && !ghost.hidden && ghostText) {
      clearTimeout(ghostTimer);
      ghostTimer = setTimeout(() => hideGhost(), GHOST_HOLD_MS);
    }
  }

  // ---- Screen Recording off: say so plainly, with the button that fixes it ----
  let notice: HTMLElement | undefined;
  function showNotice(message: string, kind: "screen" | "accessibility" = "screen") {
    // Screen Recording off matters more (Jett is blind): it is never replaced by the Accessibility one.
    if (notice?.isConnected && notice.dataset.kind === "screen" && kind === "accessibility") return;
    notice?.remove();
    const box = document.createElement("div");
    box.dataset.hit = "";
    box.dataset.kind = kind;
    box.setAttribute("role", "alert");
    Object.assign(box.style, {
      position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)", zIndex: "2147483001",
      maxWidth: "min(460px, calc(100vw - 32px))", padding: "12px 14px", borderRadius: "14px",
      background: "rgba(16, 20, 24, 0.92)", color: "#e6fffb", font: "13px/1.4 system-ui, sans-serif",
      boxShadow: "0 8px 30px rgba(0,0,0,.35)", border: `1px solid ${TEAL}55`,
      display: "flex", gap: "10px", alignItems: "center",
    });
    const text = document.createElement("span");
    text.textContent = message;
    const open = document.createElement("button");
    open.textContent = "Open Settings";
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    for (const b of [open, close]) {
      Object.assign(b.style, {
        flex: "none", border: "0", borderRadius: "8px", padding: "6px 10px", cursor: "pointer",
        background: b === open ? TEAL : "transparent", color: b === open ? "#062b27" : "#e6fffb", font: "inherit",
      });
    }
    open.onclick = () => {
      // Ask macOS (its prompt shows once), then open the pane either way.
      const path = kind === "screen" ? "permission" : "accessibility";
      void fetch(`${info.url}/screen/${path}`, { method: "POST", headers: auth }).catch(() => {});
      void invoke(kind === "screen" ? "open_screen_settings" : "open_accessibility_settings").catch(() => {});
    };
    close.onclick = () => box.remove();
    box.append(text, open, close);
    document.body.appendChild(box);
    notice = box;
  }

  const AX_OFF =
    "Jett can't find buttons by name: Accessibility is off. Turn on Jett in System Settings > Privacy & Security > " +
    "Accessibility so it can point at the exact control (it still reads the screen without it).";
  const OFF =
    "Jett can't see your screen: Screen Recording is off. Turn on Jett in System Settings > Privacy & Security > " +
    "Screen Recording, then quit and reopen Jett.";
  // Detect it at launch: off means the notice now, not a silent failure at the first "what's this?".
  void fetch(`${info.url}/screen/permission`, { headers: auth })
    .then((r) => (r.ok ? r.json() : { granted: true }))
    .then((r: { granted?: boolean }) => r.granted === false && showNotice(OFF))
    .catch(() => {});
  void fetch(`${info.url}/screen/accessibility`, { headers: auth })
    .then((r) => (r.ok ? r.json() : { granted: true }))
    .then((r: { granted?: boolean }) => r.granted === false && showNotice(AX_OFF, "accessibility"))
    .catch(() => {});

  return {
    start,
    finish,
    onEvent(event) {
      onAnswer(event);
      if (event.type === "screen.permission" && !event.granted) {
        if (event.kind === "accessibility") showNotice(AX_OFF, "accessibility");
        else showNotice(OFF);
      }
    },
  };
}
