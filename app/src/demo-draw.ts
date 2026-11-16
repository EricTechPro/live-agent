// Dev only (drawing v2): a sample multi-card drawing played through the real sketch view
// with a fake core, so the look and the motion can be checked (and screenshotted)
// without Gemini. Served by the Vite dev server at /demo-draw.html; not in the app build.
//
// The fake core emits what the real one would: one `canvas.beat` per beat at once
// (the draw tool's result), then `canvas.speak` as the "voice" reaches each line
// (paced at 15 characters a second, like pen.ts expects), with the voice's transcription
// streaming word by word into the caption bar (captions.ts `barLine`), as main.ts does.
import type { Mark } from "../../src/core/canvas.ts";
import type { AgentEvent } from "../../src/core/events.ts";
import { addCaption, barLine, noCaptions } from "./captions.ts";
import { beatMs } from "./pen.ts";
import { mountSketch } from "./sketch-view.ts";

const beats: { say: string; marks: Record<string, unknown>[] }[] = [
  {
    say: "A black hole starts as a giant star that runs out of fuel and collapses.",
    marks: [{
      kind: "timeline", id: "p1", title: "timeline",
      items: [
        { label: "Star", note: "Over 20 times our sun" },
        { label: "Collapse", note: "Fuel gone, core crushed" },
        { label: "Supernova", note: "Outer layers explode" },
        { label: "Black hole", note: "Light can't escape" },
      ],
    }],
  },
  {
    say: "What is left has three parts.",
    marks: [{
      kind: "list", id: "p2", title: "anatomy", heading: "Inside a black hole",
      items: [
        { label: "Event horizon", note: "The point of no return" },
        { label: "Accretion disk", note: "Hot gas spiralling in" },
        { label: "Singularity", note: "All the mass, no size" },
      ],
    }],
  },
  {
    say: "The edge of no return is the event horizon.",
    marks: [
      { kind: "circle", id: "p3", on: "p2", item: 1 },
      { kind: "check", id: "p4", on: "p2", item: 3 },
    ],
  },
  {
    say: "They come in very different sizes.",
    marks: [{
      kind: "bars", id: "p5", title: "how heavy", unit: " suns",
      items: [{ label: "Cygnus X-1", value: 21 }, { label: "GW150914", value: 62 }, { label: "GW190521", value: 142 }],
    }],
  },
  {
    say: "And this is how light gets trapped.",
    marks: [
      { kind: "flow", id: "p6", title: "trapped light", items: [{ label: "Light comes close" }, { label: "Space bends" }, { label: "No way out" }] },
      { kind: "arrow", id: "p7", on: "p2", to_card: "p6" },
    ],
  },
];

// ?scene=more: the other kinds, an overlapping loose sketch, and a fifth card that closes the oldest.
const more: typeof beats = [
  {
    say: "Here is how the three options compare.",
    marks: [{
      kind: "table", id: "p1", title: "compare", columns: ["Option", "Cost", "Speed"],
      items: [{ label: "Gemini Live", cells: ["Low", "Real time"] }, { label: "Whisper + GPT", cells: ["Medium", "About a second"] }, { label: "Local model", cells: ["Free", "Depends on the laptop"] }],
    }],
  },
  {
    say: "The pieces talk to each other like this.",
    marks: [{ kind: "diagram", id: "p2", title: "how it fits", source: "flowchart LR\n  mic[Mic] --> core[Core]\n  core --> gemini[Gemini Live]\n  gemini --> voice[Voice]\n  core --> brain[(Brain)]" }],
  },
  {
    say: "A quick sketch, even if I scribble on top of myself.",
    marks: [
      { kind: "box", id: "p3", x: 100, y: 100, w: 260, h: 120, label: "Your voice" },
      { kind: "box", id: "p4", x: 120, y: 120, w: 260, h: 120, label: "Jett's core" },
      { kind: "text", id: "p5", x: 130, y: 160, text: "words on words" },
      { kind: "arrow", id: "p6", from: { x: 360, y: 160 }, to: { x: 700, y: 160 }, label: "streams" },
      { kind: "circle", id: "p7", x: 820, y: 170, r: 90 },
      { kind: "text", id: "p8", x: 1200, y: 700, text: "off the board" },
    ],
  },
  {
    say: "Then the steps to set it up.",
    marks: [{ kind: "list", id: "p9", title: "setup", numbered: true, items: [{ label: "Paste your Gemini key" }, { label: "Pick your notes folder" }, { label: "Hold Ctrl and Option, then talk" }] }],
  },
  {
    say: "And one more card, so the oldest one makes room.",
    marks: [
      { kind: "timeline", id: "p10", title: "this week", items: [{ label: "Mon", note: "Draw v2" }, { label: "Wed", note: "Screen marks" }, { label: "Fri", note: "DevFest dry run" }] },
      { kind: "underline", id: "p11", on: "p10", item: 3 },
    ],
  },
];

type Listener = (e: AgentEvent) => void;
const listeners: Listener[] = [];
const emit = (e: AgentEvent) => listeners.forEach((l) => l(e));
const core = { onEvent: (fn: Listener) => void listeners.push(fn) };

const stage = document.getElementById("stage")!;
const sketch = mountSketch(core as never, stage);
// The fake browser window stands in for the front app: cards keep off it.
const front = () => {
  const r = document.querySelector<HTMLElement>(".win")!.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const avoidFront = () => sketch.setObstacles([front()], "left");
avoidFront();
window.addEventListener("resize", avoidFront);
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && sketch.openCount()) sketch.clearAll();
});

const scene = new URLSearchParams(location.search).get("scene") === "more" ? more : beats;
const speed = Number(new URLSearchParams(location.search).get("speed") ?? "1") || 1;
async function play() {
  await document.fonts.ready;
  const id = "demo1";
  scene.forEach((b, i) => emit({ type: "canvas.beat", id, beat: i, say: b.say, marks: b.marks as Mark[] }));
  // The "voice" says each line in turn.
  let t = 0;
  let captions = noCaptions;
  const hear = (e: AgentEvent) => (captions = addCaption(captions, e, performance.now()));
  scene.forEach((b, i) => {
    setTimeout(() => emit({ type: "canvas.speak", id, beat: i }), t / speed);
    // The line's words, as Gemini's output transcription streams them.
    const words = b.say.split(/(?=\s)/);
    const per = beatMs(b.say) / words.length;
    words.forEach((w, k) => setTimeout(() => hear({ type: "transcript", role: "model", text: i && !k ? ` ${w}` : w }), (t + k * per) / speed));
    t += beatMs(b.say) + 900;
  });
  setTimeout(() => {
    hear({ type: "turn.done", reply: "" } as AgentEvent);
    Object.assign(window, { __demoSpoken: true });
  }, t / speed);
  setInterval(() => sketch.setCaption(barLine(captions, performance.now(), false)), 100);
}
void play();
Object.assign(window, { __sketch: sketch });
