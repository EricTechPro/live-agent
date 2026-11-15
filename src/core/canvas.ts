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
  const problems = result.error.issues.map((issue) => {
    const where = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
    return where ? `beats${where}: ${issue.message}` : issue.message;
  });
  throw new Error(`Nothing was drawn. ${problems.slice(0, 5).join("; ")}`);
}
