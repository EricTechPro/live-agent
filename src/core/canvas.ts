// The sketch canvas's marks (ticket 31): small shapes on a fixed virtual board.
//
//   const beats = parseBeats(args.beats);   // throws a plain message on any bad mark
//   for (const beat of beats) emit({ type: "canvas.beat", ... });
//
// Why Zod: marks come from the model, and the window draws them as-is. Every
// mark is checked here (kind, id, coordinates on the board), so a bad call is
// a tool error the model hears and nothing half-drawn reaches the window.
// Why a fixed board: the model thinks in one coordinate space, the window
// scales it to whatever size the Canvas tab has.
import { z } from "zod";

export const BOARD = { width: 1000, height: 600 } as const;

/** Colours a mark may use. "ink" is the default pen. */
export const COLORS = ["ink", "red", "blue", "green", "orange", "purple"] as const;

const X = z.number().min(0).max(BOARD.width);
const Y = z.number().min(0).max(BOARD.height);
const point = z.object({ x: X, y: Y });
const id = z.string().regex(/^p[1-9]\d*$/, "ids look like p1, p2, p3");
const color = z.enum(COLORS).optional();
const label = z.string().trim().min(1).max(60).optional();

const box = z.object({ kind: z.literal("box"), id, x: X, y: Y, w: z.number().positive(), h: z.number().positive(), label, color });
const text = z.object({ kind: z.literal("text"), id, x: X, y: Y, text: z.string().trim().min(1).max(80), size: z.number().min(8).max(96).optional(), color });
const arrow = z.object({ kind: z.literal("arrow"), id, from: point, to: point, label, color });
const line = z.object({ kind: z.literal("line"), id, from: point, to: point, color });
const circle = z.object({ kind: z.literal("circle"), id, x: X, y: Y, r: z.number().positive(), color });
const underline = z.object({ kind: z.literal("underline"), id, x: X, y: Y, w: z.number().positive(), color });
const check = z.object({ kind: z.literal("check"), id, x: X, y: Y, size: z.number().positive().max(200).optional(), color });
const cross = z.object({ kind: z.literal("cross"), id, x: X, y: Y, size: z.number().positive().max(200).optional(), color });
const step = z.object({ kind: z.literal("step"), id, x: X, y: Y, n: z.number().int().min(1).max(99), label, color });

const mark = z
  .discriminatedUnion("kind", [box, text, arrow, line, circle, underline, check, cross, step])
  .superRefine((m, ctx) => {
    // Shapes with a size must fit on the board too, not only their corner.
    const off =
      (m.kind === "box" && (m.x + m.w > BOARD.width || m.y + m.h > BOARD.height)) ||
      (m.kind === "circle" && (m.x - m.r < 0 || m.y - m.r < 0 || m.x + m.r > BOARD.width || m.y + m.r > BOARD.height)) ||
      (m.kind === "underline" && m.x + m.w > BOARD.width);
    if (off) ctx.addIssue({ code: "custom", message: `${m.id} goes off the board (${BOARD.width} x ${BOARD.height})` });
  });

export const MARK_KINDS = ["box", "text", "arrow", "line", "circle", "underline", "check", "cross", "step"] as const;
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

const edit = z
  .object({ id, color, label: z.string().trim().min(1).max(80).optional(), x: X.optional(), y: Y.optional() })
  .refine((e) => e.color !== undefined || e.label !== undefined || e.x !== undefined || e.y !== undefined, {
    message: "nothing to change: give a color, label, x or y",
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

const onBoard = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= BOARD.width && p.y <= BOARD.height;

/**
 * The mark with one change applied, checked again (it must still fit the board).
 * A move puts the mark's anchor at x / y: a box's corner, a ring's centre, an
 * arrow's or line's start (its end moves with it). `label` is the words of a
 * text mark and the label of a box, arrow or step. Throws a plain message.
 */
export function applyEdit(m: Mark, change: MarkChange): Mark {
  const next: Record<string, unknown> = { ...m };
  if (change.color) next.color = change.color;
  if (change.label !== undefined) {
    if (m.kind === "text") next.text = change.label;
    else if (m.kind === "box" || m.kind === "arrow" || m.kind === "step") next.label = change.label;
    else throw new Error(`${m.id} is a ${m.kind}: it has no label`);
  }
  if (change.x !== undefined || change.y !== undefined) {
    if (m.kind === "arrow" || m.kind === "line") {
      const dx = (change.x ?? m.from.x) - m.from.x;
      const dy = (change.y ?? m.from.y) - m.from.y;
      const from = { x: m.from.x + dx, y: m.from.y + dy };
      const to = { x: m.to.x + dx, y: m.to.y + dy };
      if (!onBoard(from) || !onBoard(to)) throw new Error(`${m.id} goes off the board (${BOARD.width} x ${BOARD.height})`);
      Object.assign(next, { from, to });
    } else {
      if (change.x !== undefined) next.x = change.x;
      if (change.y !== undefined) next.y = change.y;
    }
  }
  const result = mark.safeParse(next);
  if (result.success) return result.data;
  throw new Error(problems(result.error, m.id));
}
