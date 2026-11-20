// Screen awareness in the window (slice 2): the user's ink while Ctrl+Option is held, and
// the "Screen Recording is off" and "Accessibility is off" (slice 3) notices. Its own layer and module, apart from the sketch
// renderer, so the drawing work can change freely.
//
// While talking (the draw keys held, Ctrl+Option by default), the pointer path is drawn on a
// see-through layer, no clicking: a smoothed mint line with a dark edge (ink-stroke.ts), and the
// listening pill rides the pointer. It stays while you talk and fades 0.5 s after release.
// When Jett answers a circle, the real orb travels beside the circled spot with its answer
// bubble (main.ts `updateTravel`, travel.ts `addCircleEvent`), and goes home ~3.5 s after.
// The moment the ink closes, the path goes to the core (POST /screen/circle), which checks the
// loop with the same code (src/screen/geometry.ts) and sends the circled crop to the model.
// On release, POST /screen/release adds the words for the turn.
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../../src/core/events.ts";
import { findLoop, type Pt } from "../../src/screen/geometry.ts";
import { INK, loopBounds, pillRect, smooth } from "./ink-stroke.ts";
import { addCircleEvent, circled, CIRCLE_HOLD_MS, type CircleSpot } from "./travel.ts";

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
  /** The orb goes beside this circled box (global points) while it answers, or home (undefined). */
  onSpot?: (rect: { x: number; y: number; w: number; h: number } | undefined) => void;
}


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
      // An answer from here on is about this circle: the orb goes beside it.
      setSpot(circled(loopBounds(loop), Date.now()));
      // Send the crop now, while the question is still being spoken, so it is in before it ends.
      void fetch(`${info.url}/screen/circle`, { method: "POST", headers: auth, body: JSON.stringify({ stroke }) }).catch(() => {});
    }
    draw();
  }

  function start() {
    clearTimeout(fadeTimer);
    setSpot({});
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

  // ---- the answer to a circle: the real orb beside the circled spot (tickets 43/44) ----
  let spot: CircleSpot = {};
  let homeTimer: ReturnType<typeof setTimeout> | undefined;
  function setSpot(next: CircleSpot) {
    const was = spot;
    spot = next;
    if (next.shown !== was.shown) options.onSpot?.(next.shown);
    if (next.ending && !was.ending) homeTimer = setTimeout(() => setSpot({}), CIRCLE_HOLD_MS);
    else if (!next.ending) clearTimeout(homeTimer);
  }
  const onAnswer = (event: AgentEvent) => setSpot(addCircleEvent(spot, event, Date.now()));

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
