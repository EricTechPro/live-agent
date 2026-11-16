// draw: sketch on the window's canvas while talking (ticket 31).
//
// Beats: each one is a line the voice says plus the marks drawn while it is
// said. Every mark is checked with Zod (src/core/canvas.ts) before anything is
// shown; a bad mark fails the whole call so the model can fix and resend it.
// Risk class "read": it changes nothing on disk. Like every tool it runs
// NON_BLOCKING, so the voice keeps talking while the window draws.
// Idea from Roamies (AGPL): idea only, no code.
import { COLORS, MARK_KINDS, MAX_BEATS, MAX_CARDS, MAX_MARKS_PER_BEAT, parseBeats } from "../src/core/canvas.ts";
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
// Drawing v2: cards carry content only and the window places them (no overlap,
// ever); free-ink marks sit on a card or carry rough board hints.
const markSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: [...MARK_KINDS],
      description:
        "CARDS (prefer these; the app places them, never give coordinates): " +
        "timeline: items in time order (label = year or event, note = a few words). " +
        "list: items (label each line), optional heading, numbered=true for steps. " +
        "flow: 2 to 6 items, each one step of a process, drawn as boxes joined by arrows. " +
        "bars: items with label and value (and an optional unit) for a quick comparison. " +
        "table: columns (2 to 4 headers) and items whose cells are the row's values. " +
        "diagram: Mermaid source for a structure with branches. " +
        "INK (to point things out): circle, underline, check, cross, box, step: put on a card id, and item (1 = first) to mark one line of it. " +
        "arrow: on = the card it starts at, to_card = the card it points at, label optional. " +
        "Only for a loose sketch with no card: x,y on the 1000 x 600 board as rough hints (box: x,y,w,h; circle: x,y,r; arrow/line: from,to; text: x,y,text).",
    },
    id: { type: "string", description: "p1, p2, p3 ... unique on the canvas; later turns refer to it." },
    title: { type: "string", description: "Cards: one to three words, e.g. 'timeline', 'his legacy', 'how it works'." },
    items: {
      type: "array",
      description: "Cards: the entries (timeline events, list lines, flow steps, bars, table rows). Short words, at most 8.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "The main words, one to five." },
          note: { type: "string", description: "Optional second line, a few words (timeline, list)." },
          value: { type: "number", description: "bars: the number." },
          cells: { type: "array", items: { type: "string" }, description: "table: the row's values, one per column." },
        },
        required: ["label"],
      },
    },
    heading: { type: "string", description: "list: an optional bigger first line." },
    numbered: { type: "boolean", description: "list: true numbers the lines (steps)." },
    unit: { type: "string", description: "bars: unit after each value, e.g. %, ms." },
    columns: { type: "array", items: { type: "string" }, description: "table: 2 to 4 column headers." },
    source: { type: "string", description: "diagram: Mermaid source, e.g. 'flowchart LR' with short labels, about 15 nodes at most." },
    on: { type: "string", description: "Ink: the card id this mark sits on (or an arrow starts at)." },
    item: { type: "integer", description: "Ink on a card: which item it marks, 1 = first." },
    to_card: { type: "string", description: "arrow / line: the card id it points at." },
    x: num("Loose sketch only: rough x hint, 0 to 1000."),
    y: num("Loose sketch only: rough y hint, 0 to 600."),
    w: num("Loose sketch only: width (box, underline)."),
    h: num("Loose sketch only: height (box)."),
    r: num("Loose sketch only: radius (circle)."),
    size: num("Size (check, cross, text font size)."),
    n: { type: "integer", description: "The step number (step)." },
    text: { type: "string", description: "The words (text). Short." },
    label: { type: "string", description: "A short label (box, arrow, step). One to four words." },
    from: point("Loose sketch only: start (arrow, line)."),
    to: point("Loose sketch only: end (arrow, line)."),
    color: { type: "string", enum: [...COLORS], description: "Pen colour. Default ink." },
  },
  required: ["kind", "id"],
};

export default defineTool<{ beats: unknown }>({
  name: "draw",
  description:
    "Explain visually while you talk: cards float on the user's screen and the app lays them out (never overlapping), " +
    "so pick a card kind and give its content, not coordinates. " +
    "Usually one card per beat (a timeline, then a list ...), with circle / underline / check / arrow marks on cards to point things out. " +
    `At most ${MAX_CARDS} cards stay up; older ones close. ` +
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
    const spots = checked.flatMap((b) => b.marks).filter((m) => m.kind === "spot");
    if (spots.length) throw new Error(`Nothing was drawn. ${spots[0]!.id}: to mark something on the real screen, call mark_screen.`);
    canvas.draw(checked);
    const ids = checked.flatMap((b) => b.marks.map((m) => m.id));
    // Every id on the canvas, so later turns can say "make p2 red" (edit_canvas).
    return { drawn: ids.length, ids, canvas: canvas.ids() };
  },
});
