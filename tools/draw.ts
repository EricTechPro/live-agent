// draw: sketch on the window's canvas while talking (ticket 31).
//
// Beats: each one is a line the voice says plus the marks drawn while it is
// said. Every mark is checked with Zod (src/core/canvas.ts) before anything is
// shown; a bad mark fails the whole call so the model can fix and resend it.
// Risk class "read": it changes nothing on disk. Like every tool it runs
// NON_BLOCKING, so the voice keeps talking while the window draws.
// Idea from Roamies (AGPL): idea only, no code.
import { BOARD, COLORS, MARK_KINDS, MAX_BEATS, MAX_MARKS_PER_BEAT, parseBeats } from "../src/core/canvas.ts";
import { defineTool } from "../src/core/tool.ts";

const num = (description: string) => ({ type: "number", description });
const point = (description: string) => ({
  type: "object",
  description,
  properties: { x: num("0 to 1000"), y: num("0 to 600") },
  required: ["x", "y"],
});

// One flat mark schema (Gemini Live takes a plain OpenAPI subset, no oneOf).
// Which fields a kind needs is in the descriptions; Zod checks it for real.
const markSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: [...MARK_KINDS],
      description:
        "box: x,y (top-left), w,h, label. text: x,y, text. arrow / line: from, to (arrow may have a label). " +
        "circle: a ring at x,y (centre) with radius r. underline: x,y, w. check / cross: x,y (centre), size. " +
        "step: a numbered dot at x,y with n and a label.",
    },
    id: { type: "string", description: "p1, p2, p3 ... unique on the canvas; later turns refer to it." },
    x: num("Left edge (box) or centre, 0 to 1000."),
    y: num("Top edge (box) or centre, 0 to 600."),
    w: num("Width (box, underline)."),
    h: num("Height (box)."),
    r: num("Radius (circle)."),
    size: num("Size (check, cross, text font size)."),
    n: { type: "integer", description: "The step number (step)." },
    text: { type: "string", description: "The words (text). Short." },
    label: { type: "string", description: "A short label (box, arrow, step). One to four words." },
    from: point("Start (arrow, line)."),
    to: point("End (arrow, line)."),
    color: { type: "string", enum: [...COLORS], description: "Pen colour. Default ink." },
  },
  required: ["kind", "id"],
};

export default defineTool<{ beats: unknown }>({
  name: "draw",
  description:
    `Sketch on the user's canvas while you talk. The board is ${BOARD.width} wide and ${BOARD.height} tall (x right, y down). ` +
    "Send beats: each beat is one short line you say plus the marks drawn while you say it. " +
    `Keep it to a few marks per beat (at most ${MAX_MARKS_PER_BEAT}) and at most ${MAX_BEATS} beats. ` +
    "Give every mark a new id (p1, p2, ...). Say the beats' lines out loud in order; do not read the marks.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      beats: {
        type: "array",
        description: "The beats, in the order you say them.",
        items: {
          type: "object",
          properties: {
            say: { type: "string", description: "The line you say while these marks are drawn." },
            marks: { type: "array", items: markSchema, description: "The marks for this beat." },
          },
          required: ["say", "marks"],
        },
      },
    },
    required: ["beats"],
  },
  run({ beats }, { canvas }) {
    const checked = parseBeats(beats);
    canvas.draw(checked);
    const ids = checked.flatMap((b) => b.marks.map((m) => m.id));
    // Every id on the canvas, so later turns can say "make p2 red" (edit_canvas).
    return { drawn: ids.length, ids, canvas: canvas.ids() };
  },
});
