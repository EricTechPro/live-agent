// The sketch canvas's marks (tickets 31, 35; drawing v2): what the model may draw.
//
//   const beats = parseBeats(args.beats);   // throws a plain message on any bad mark
//   for (const beat of beats) emit({ type: "canvas.beat", ... });
//
// Why Zod: marks come from the model. Every mark is checked here (kind, id,
// content sizes), so a bad call is a tool error the model hears and nothing
// half-drawn reaches the window.
//
// Drawing v2: the model says WHAT to show, code decides WHERE. Cards (timeline,
// list, flow, bars, table, diagram) carry content only; the window lays them out
// in columns with no overlap (app/src/layout.ts). Free-ink marks (circle, arrow,
// check ...) either sit `on` a card (and an `item` of it) or carry x / y on the
// 1000 x 600 board as rough hints. Hints are clamped onto the board, never
// refused: the layout pass moves things anyway.
import { z } from "zod";
import { CARD_KINDS, isCard } from "./card-kinds.ts";

export { CARD_KINDS, isCard, MAX_CARDS, type CardKind } from "./card-kinds.ts";

export const BOARD = { width: 1000, height: 600 } as const;

/** Colours a mark may use. "ink" is the default pen. */
export const COLORS = ["ink", "red", "blue", "green", "orange", "purple"] as const;

const clampTo = (max: number) => z.number().transform((v) => Math.min(max, Math.max(0, v)));
const X = clampTo(BOARD.width);
const Y = clampTo(BOARD.height);
const point = z.object({ x: X, y: Y });
const id = z.string().regex(/^p[1-9]\d*$/, "ids look like p1, p2, p3");
const color = z.enum(COLORS).optional();
const label = z.string().trim().min(1).max(60).optional();
const size = (max: number) => z.number().positive().transform((v) => Math.min(max, v));

/** Where a free-ink mark goes: on a card (by id), optionally on one of its items (1 = first). */
const on = id.optional();
const item = z.number().int().min(1).max(12).optional();
const target = { on, item };

const box = z.object({ kind: z.literal("box"), id, x: X.optional(), y: Y.optional(), w: size(BOARD.width).optional(), h: size(BOARD.height).optional(), label, color, ...target });
const text = z.object({ kind: z.literal("text"), id, x: X.optional(), y: Y.optional(), text: z.string().trim().min(1).max(80), size: z.number().min(8).max(96).optional(), color, ...target });
const arrow = z.object({ kind: z.literal("arrow"), id, from: point.optional(), to: point.optional(), label, color, on, to_card: id.optional() });
const line = z.object({ kind: z.literal("line"), id, from: point.optional(), to: point.optional(), color, on, to_card: id.optional() });
const circle = z.object({ kind: z.literal("circle"), id, x: X.optional(), y: Y.optional(), r: size(BOARD.height / 2).optional(), color, ...target });
const underline = z.object({ kind: z.literal("underline"), id, x: X.optional(), y: Y.optional(), w: size(BOARD.width).optional(), color, ...target });
const check = z.object({ kind: z.literal("check"), id, x: X.optional(), y: Y.optional(), size: size(200).optional(), color, ...target });
const cross = z.object({ kind: z.literal("cross"), id, x: X.optional(), y: Y.optional(), size: size(200).optional(), color, ...target });
const step = z.object({ kind: z.literal("step"), id, x: X.optional(), y: Y.optional(), n: z.number().int().min(1).max(99), label, color, ...target });

// ---- cards (drawing v2): content only, placed by the window ----------------------

const title = z.string().trim().min(1).max(40).optional();
/** How big a card opens: small, normal (default), large, or full (it fills the screen until Esc). */
export const CARD_SIZES = ["small", "normal", "large", "full"] as const;
const card_size = z.enum(CARD_SIZES).optional();
const words = (max: number) => z.string().trim().min(1).max(max);
/** One entry of a card: a timeline event, a list line, a flow step, a bar or a table row. */
const entry = z.object({
  label: words(60),
  note: words(90).optional(),
  value: z.number().finite().optional(),
  cells: z.array(z.string().trim().max(40)).max(4).optional(),
});
const entries = (min: number, max: number, what: string) =>
  z.array(entry).min(min, `a ${what} needs at least ${min} items`).max(max, `a ${what} takes at most ${max} items`);

const timeline = z.object({ kind: z.literal("timeline"), id, title, items: entries(2, 8, "timeline"), color, card_size });
const list = z.object({ kind: z.literal("list"), id, title, heading: words(60).optional(), numbered: z.boolean().optional(), items: entries(1, 8, "list"), color, card_size });
const flow = z.object({ kind: z.literal("flow"), id, title, items: entries(2, 6, "flow"), color, card_size });
const bars = z.object({ kind: z.literal("bars"), id, title, unit: z.string().trim().max(8).optional(), items: entries(1, 8, "bar chart"), color, card_size })
  .superRefine((m, ctx) => {
    m.items.forEach((it, i) => {
      if (it.value === undefined || it.value < 0) ctx.addIssue({ code: "custom", path: ["items", i, "value"], message: "every bar needs a value of 0 or more" });
    });
  });
const table = z.object({ kind: z.literal("table"), id, title, columns: z.array(words(24)).min(2, "a table needs 2 to 4 columns").max(4, "a table needs 2 to 4 columns"), items: entries(1, 8, "table"), color, card_size });

// A Mermaid card (ticket 35). x / y / w / h are old hints, kept so older calls still parse.
const diagram = z.object({
  kind: z.literal("diagram"), id, x: X.optional(), y: Y.optional(),
  w: z.number().min(120, "a diagram card is at least 120 wide").max(BOARD.width).optional(),
  h: z.number().min(80, "a diagram card is at least 80 tall").max(BOARD.height).optional(),
  source: z.string({ message: "source is the Mermaid diagram" }).trim().min(1, "source is empty: send Mermaid source").max(4000),
  title,
  color,
  card_size,
});

// ---- screen marks (slice 4): on real UI, placed by code, never by the model ---------
//
// The model names a target in `mark_screen` (words or a description); the core finds it
// (src/screen/locator.ts) and draws a `spot` with the found rect in global screen points.
// `texts`: words around it on screen, so its label chip covers as few as it can.
export const SPOT_STYLES = ["ring", "arrow", "underline", "highlight", "label"] as const;
const screenRect = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() });
const spot = z.object({
  kind: z.literal("spot"), id, style: z.enum(SPOT_STYLES), rect: screenRect, label: z.string().trim().min(1).max(40).optional(), color,
  texts: z.array(screenRect).max(120).optional(),
  via: z.enum(["ax", "ocr", "vision"]).optional(),
});

const NEEDS_SPOT: Record<string, string[]> = {
  box: ["x", "y", "w", "h"], text: ["x", "y"], circle: ["x", "y", "r"], underline: ["x", "y", "w"],
  check: ["x", "y"], cross: ["x", "y"], step: ["x", "y"],
};

const mark = z
  .discriminatedUnion("kind", [box, text, arrow, line, circle, underline, check, cross, step, diagram, timeline, list, flow, bars, table, spot])
  .superRefine((m, ctx) => {
    // A free mark needs a place: a card to sit on, or board hints.
    const r = m as Record<string, unknown>;
    if (m.kind === "arrow" || m.kind === "line") {
      if (!(m.on && m.to_card) && !(m.from && m.to))
        ctx.addIssue({ code: "custom", message: `${m.id}: give on + to_card (card ids) or from + to (board points)` });
      return;
    }
    const need = NEEDS_SPOT[m.kind];
    if (!need || r.on) return;
    const missing = need.filter((k) => r[k] === undefined);
    if (missing.length) ctx.addIssue({ code: "custom", message: `${m.id}: give on (a card id) or ${missing.join(", ")}` });
  });

export const INK_KINDS = ["box", "text", "arrow", "line", "circle", "underline", "check", "cross", "step"] as const;
export const MARK_KINDS = [...CARD_KINDS, ...INK_KINDS] as const;
export const MAX_BEATS = 8;
export const MAX_MARKS_PER_BEAT = 12;


const beat = z.object({ say: z.string().trim().min(1, "say is empty"), marks: z.array(mark).min(1).max(MAX_MARKS_PER_BEAT) });
const beats = z
  .array(beat)
  .min(1, "send at least one beat")
  .max(MAX_BEATS)
  .superRefine((all, ctx) => {
    const seen = new Set<string>();
    for (const b of all)
      for (const m of b.marks) {
        if (seen.has(m.id)) ctx.addIssue({ code: "custom", message: `${m.id} is used twice: every mark needs its own id` });
        seen.add(m.id);
      }
  });

export type Mark = z.infer<typeof mark>;
export type MarkKind = Mark["kind"];
export type Beat = z.infer<typeof beat>;

/** Check the model's beats. Throws one plain message naming every problem (path: what is wrong). */
export function parseBeats(input: unknown): Beat[] {
  const result = beats.safeParse(input);
  if (result.success) return result.data;
  throw new Error(`Nothing was drawn. ${problems(result.error, "beats")}`);
}

/** One plain message naming every problem (path: what is wrong). */
function problems(error: z.ZodError, root: string): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
      return where ? `${root}${where}: ${issue.message}` : issue.message;
    })
    .slice(0, 5)
    .join("; ");
}

// ---- edits (ticket 33) ---------------------------------------------------------

/** A relative move on the board, in board units: -1000 to 1000. */
const delta = z.number().finite().min(-BOARD.width, "dx and dy are -1000 to 1000").max(BOARD.width, "dx and dy are -1000 to 1000");
const edit = z
  .object({ id, color, label: z.string().trim().min(1).max(80).optional(), x: X.optional(), y: Y.optional(), dx: delta.optional(), dy: delta.optional() })
  .refine((e) => e.color !== undefined || e.label !== undefined || e.x !== undefined || e.y !== undefined || !!e.dx || !!e.dy, {
    message: "nothing to change: give a color, label, x, y, dx or dy",
  })
  .refine((e) => !((e.x !== undefined && e.dx !== undefined) || (e.y !== undefined && e.dy !== undefined)), {
    message: "give x or dx (and y or dy), not both",
  });
const editArgs = z
  .object({ edits: z.array(edit).max(20).optional(), erase: z.array(z.string().trim()).max(50).optional() })
  .refine((a) => (a.edits?.length ?? 0) + (a.erase?.length ?? 0) > 0, { message: "send edits or erase (or both)" });

export type MarkEdit = z.infer<typeof edit>;
export type MarkChange = Omit<MarkEdit, "id">;

/** Check an `edit_canvas` call. `erase` holding "all" means every mark. Throws one plain message. */
export function parseEdits(input: unknown): { edits: MarkEdit[]; erase: string[] | "all" } {
  const result = editArgs.safeParse(input);
  if (!result.success) throw new Error(`Nothing was changed. ${problems(result.error, "args")}`);
  const erase = result.data.erase ?? [];
  return { edits: result.data.edits ?? [], erase: erase.some((e) => e.toLowerCase() === "all") ? "all" : erase };
}


const r = (m: Mark) => m as Record<string, unknown>;

/**
 * The mark with one change applied, checked again.
 * A move puts a loose mark's anchor hint at x / y: a box's corner, a ring's centre, an
 * arrow's or line's start (its end moves with it); dx / dy move it by that much instead
 * (clamped onto the board). Cards and marks on cards are placed
 * by the window, so they refuse a move. `label` is the words of a text mark, the title
 * of a card, and the label of a box, arrow or step. Throws a plain message.
 */
export function applyEdit(m: Mark, change: MarkChange): Mark {
  const next: Record<string, unknown> = { ...m };
  if (change.color) next.color = change.color;
  if (change.label !== undefined) {
    if (m.kind === "text") next.text = change.label;
    else if (isCard(m)) next.title = change.label;
    else if (m.kind === "box" || m.kind === "arrow" || m.kind === "step" || m.kind === "spot") next.label = change.label;
    else throw new Error(`${m.id} is a ${m.kind}: it has no label`);
  }
  const moves = change.x !== undefined || change.y !== undefined || !!change.dx || !!change.dy;
  if (moves) {
    if (m.kind === "spot") {
      throw new Error(`${m.id} marks something real on the screen: it stays on it and cannot be moved by x / y`);
    } else if (isCard(m) || r(m).on) {
      throw new Error(`${m.id} is placed for you (cards and marks on cards never overlap): it cannot be moved by x / y`);
    } else if (m.kind === "arrow" || m.kind === "line") {
      if (!m.from || !m.to) throw new Error(`${m.id} joins two cards: it cannot be moved by x / y`);
      const dx = change.x !== undefined ? change.x - m.from.x : (change.dx ?? 0);
      const dy = change.y !== undefined ? change.y - m.from.y : (change.dy ?? 0);
      Object.assign(next, { from: { x: m.from.x + dx, y: m.from.y + dy }, to: { x: m.to.x + dx, y: m.to.y + dy } });
    } else {
      const at = r(m) as { x?: number; y?: number };
      if (change.x !== undefined) next.x = change.x;
      else if (change.dx) next.x = (at.x ?? 0) + change.dx;
      if (change.y !== undefined) next.y = change.y;
      else if (change.dy) next.y = (at.y ?? 0) + change.dy;
    }
  }
  const result = mark.safeParse(next);
  if (result.success) return result.data;
  throw new Error(problems(result.error, m.id));
}
