// Screen awareness in the window (slice 2): the user's ink while Ctrl+Option is held, and
// the "Screen Recording is off" notice. Its own layer and module, apart from the sketch
// renderer, so the drawing work can change freely.
//
// While talking (Ctrl+Option held), the pointer path is drawn in teal on a see-through layer,
// no clicking. A stroke that closes into a loop glows; loose lines just fade. On release the
// whole path goes to the core (POST /screen/release), which decides again which part is a
// loop (src/screen/geometry.ts, the same code) and sends the circled crop to the model.
import { invoke } from "@tauri-apps/api/core";
import type { AgentEvent } from "../../src/core/events.ts";
import { findLoop, type Pt } from "../../src/screen/geometry.ts";

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

export function createScreenInk(info: CoreInfo): ScreenInk {
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
    if (stroke.length < 2) return;
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = closed ? 5 : 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = TEAL;
    ctx.shadowBlur = closed ? 18 : 4;
    ctx.beginPath();
    // Global points -> this window's CSS pixels: subtract the window's own origin.
    ctx.moveTo(stroke[0]!.x - origin.x, stroke[0]!.y - origin.y);
    for (const p of stroke.slice(1)) ctx.lineTo(p.x - origin.x, p.y - origin.y);
    ctx.stroke();
  }

  async function sample() {
    const at = await invoke<Pointer | null>("pointer_global").catch(() => null);
    if (!at || !timer) return;
    origin = { x: at.originX, y: at.originY };
    const last = stroke.at(-1);
    if (last && Math.hypot(at.x - last.x, at.y - last.y) < MIN_STEP) return;
    stroke.push({ x: at.x, y: at.y });
    if (!closed && stroke.length >= 8) closed = !!findLoop(stroke);
    draw();
  }

  function start() {
    clearTimeout(fadeTimer);
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
    const path = stroke.length > 1500 ? stroke.filter((_, k) => k % Math.ceil(stroke.length / 1500) === 0) : stroke;
    const body = { stroke: path, cursor: stroke.at(-1), holdMs: Math.round(performance.now() - startedAt) };
    void fetch(`${info.url}/screen/release`, { method: "POST", headers: auth, body: JSON.stringify(body) }).catch(() => {});
    // A circle stays lit a moment (it was sent); a loose line fades at once.
    canvas.style.transition = "opacity 400ms ease";
    fadeTimer = setTimeout(() => (canvas.style.opacity = "0"), closed ? 900 : 50);
  }

  // ---- Screen Recording off: say so plainly, with the button that fixes it ----
  let notice: HTMLElement | undefined;
  function showNotice(message: string) {
    notice?.remove();
    const box = document.createElement("div");
    box.dataset.hit = "";
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
      void fetch(`${info.url}/screen/permission`, { method: "POST", headers: auth }).catch(() => {});
      void invoke("open_screen_settings").catch(() => {});
    };
    close.onclick = () => box.remove();
    box.append(text, open, close);
    document.body.appendChild(box);
    notice = box;
  }

  const OFF =
    "Jett can't see your screen: Screen Recording is off. Turn on Jett in System Settings > Privacy & Security > " +
    "Screen Recording, then quit and reopen Jett.";
  // Detect it at launch: off means the notice now, not a silent failure at the first "what's this?".
  void fetch(`${info.url}/screen/permission`, { headers: auth })
    .then((r) => (r.ok ? r.json() : { granted: true }))
    .then((r: { granted?: boolean }) => r.granted === false && showNotice(OFF))
    .catch(() => {});

  return {
    start,
    finish,
    onEvent(event) {
      if (event.type === "screen.permission" && !event.granted) showNotice(OFF);
    },
  };
}
