// Dev only (slice 4): screen marks played through the real sketch view over a full-screen
// app backdrop (app/demo-marks.html), with a fake core, so the look can be checked and
// screenshotted without Gemini or a Mac permission. Not in the app build.
//
// Each mark's rect is the backdrop element's box, and its `texts` are the boxes of every
// line of words on the backdrop, the same data the locator hands the real thing.
// ?stale=1: a "scroll" erases the marks after they are drawn, as the core does.
import type { Mark } from "../../src/core/canvas.ts";
import type { AgentEvent } from "../../src/core/events.ts";
import { beatMs } from "./pen.ts";
import { frontWindowAvoid } from "./front-window.ts";
import { mountSketch } from "./sketch-view.ts";

type Listener = (e: AgentEvent) => void;
const listeners: Listener[] = [];
const emit = (e: AgentEvent) => listeners.forEach((l) => l(e));
const core = { onEvent: (fn: Listener) => void listeners.push(fn) };

const rectOf = (id: string) => {
  const r = document.getElementById(id)!.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
/** Every line of words on the backdrop (what OCR would read), plus its controls (what Accessibility lists). */
function wordBoxes() {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const walker = document.createTreeWalker(document.querySelector(".app")!, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 2) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  for (const el of document.querySelectorAll<HTMLElement>(".app button, .acts span, .num, .tabs span, .slider, .avatar, .search, .card2 i")) {
    const r = el.getBoundingClientRect();
    out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

const params = new URLSearchParams(location.search);
const speed = Number(params.get("speed") ?? "1") || 1;
const stage = document.getElementById("stage")!;
const sketch = mountSketch(core as never, stage);
// Jett's orb sits bottom right in the app; cards keep off it. The app fills the screen, so
// (as main.ts does) its top band is hard and its words and controls are soft obstacles.
const orb = { x: innerWidth - 120, y: innerHeight - 160, w: 100, h: 100 };
const avoidFront = (soft: { x: number; y: number; w: number; h: number }[]) =>
  sketch.setObstacles([orb, ...frontWindowAvoid({ x: 0, y: 0, w: innerWidth, h: innerHeight }, { width: innerWidth, height: innerHeight }).hard], "left", soft);

type Beat = { say: string; marks: Record<string, unknown>[] };

/**
 * ?fixture=<url>: a real run instead of the mock app. The JSON is
 * { backdrop: <screenshot url>, beats: [{ say, marks: [spot marks in global points] }], busy?: [boxes read] },
 * the screenshot covering the window at origin 0,0 (scripts save it from a real locator run).
 */
async function fixtureScene(url: string): Promise<Beat[]> {
  const f = (await (await fetch(url)).json()) as { backdrop: string; beats: Beat[]; busy?: { x: number; y: number; w: number; h: number }[] };
  avoidFront(f.busy ?? []);
  for (const sel of [".app", ".top"]) document.querySelector<HTMLElement>(sel)!.style.display = "none";
  Object.assign(document.body.style, { background: `url(${f.backdrop}) 0 0 / 100vw 100vh no-repeat` });
  return f.beats;
}

async function play() {
  await document.fonts.ready;
  const texts = wordBoxes();
  const spot = (id: string, style: string, el: string, label?: string) => ({ kind: "spot", id, style, rect: rectOf(el), label, texts, via: "ax" });
  const fixture = params.get("fixture");
  if (!fixture) avoidFront(texts);
  const scene: Beat[] = fixture ? await fixtureScene(fixture) : [
    { say: "That's the Subscribe button, right under the video.", marks: [spot("p1", "ring", "subscribe", "click here")] },
    { say: "The scale field is on the right panel.", marks: [spot("p2", "arrow", "scale", "Scale")] },
    { say: "This video is about drawing on screen.", marks: [spot("p3", "underline", "title"), spot("p4", "label", "channel", "Subject")] },
    { say: "It runs on Gemini Live.", marks: [spot("p5", "highlight", "gemini")] },
    {
      say: "To try it, three steps.",
      marks: [{ kind: "list", id: "p6", title: "try it", numbered: true, items: [{ label: "Hold Ctrl and Option" }, { label: "Circle what you mean" }, { label: "Ask: where is it?" }] }],
    },
  ];
  const id = "marks1";
  scene.forEach((b, i) => emit({ type: "canvas.beat", id, beat: i, say: b.say, marks: b.marks as Mark[] }));
  let t = 0;
  scene.forEach((b, i) => {
    setTimeout(() => emit({ type: "canvas.speak", id, beat: i }), t / speed);
    t += beatMs(b.say) + 900;
  });
  setTimeout(() => {
    Object.assign(window, { __demoSpoken: true });
    if (params.get("stale")) {
      emit({ type: "screen.stale", ids: ["p1", "p2", "p3", "p4", "p5"], reason: "scrolled" });
      emit({ type: "canvas.erase", id: "screen-stale", ids: ["p1", "p2", "p3", "p4", "p5"], all: false });
    }
  }, (t + 1500) / speed);
}
void play();
Object.assign(window, { __sketch: sketch });
