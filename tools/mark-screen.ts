// mark_screen: point at real things on the user's screen (slice 4).
//
// The model says WHAT to mark ("ring the Subscribe button"), by words or a description; the
// core finds WHERE (src/screen/locator.ts) and draws `spot` marks through the same canvas,
// beats and pen as `draw`, so the voice and the pen stay in step and "erase p3" works.
// All targets are found first: if one is missing nothing is drawn and the model hears which.
// The marks are pinned to the window they were found in and erased when it moves, the app
// switches, or the user scrolls or clicks there. Risk "read": it only draws on Jett's overlay.
// Idea from Roamies (AGPL): idea only, our own code.
import { z } from "zod";
import { parseBeats, SPOT_STYLES, MAX_BEATS } from "../src/core/canvas.ts";
import { defineTool } from "../src/core/tool.ts";
import type { Found } from "../src/screen/locator.ts";
import { readTarget, targetProps } from "./find-on-screen.ts";

const markArgs = z.object({
  kind: z.enum(SPOT_STYLES),
  id: z.string(),
  label: z.string().trim().min(1).max(40).optional(),
  color: z.string().optional(),
  text: z.string().optional(),
  describe: z.string().optional(),
  near: z.string().optional(),
  nth: z.number().optional(),
});
const args = z.object({
  beats: z.array(z.object({ say: z.string().trim().min(1), marks: z.array(markArgs).min(1).max(6) })).min(1).max(MAX_BEATS),
});

export default defineTool<{ beats: unknown }>({
  name: "mark_screen",
  description:
    "Point at real things on the user's screen while you talk: a ring, arrow, underline, highlight or label chip drawn " +
    "right on the actual button, field, link or words. Name each target by its words on screen (text) or what it looks " +
    "like (describe); the app finds where it is, so never give coordinates. Example: 'ring the Subscribe button' = " +
    "{kind: ring, id: p4, text: 'Subscribe', label: 'click here'}. Use it for 'where is X', 'which button', 'show me'. " +
    "Send beats like draw: each beat is one short line you say plus its marks. If a target is not found nothing is " +
    "drawn and you hear which one: say so, or try other words. Marks clear when the user scrolls, clicks or switches app.",
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
            marks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: [...SPOT_STYLES],
                    description: "ring: loop round it. arrow: points at it. underline: line under words. highlight: marker wash over words. label: just a chip naming it.",
                  },
                  id: { type: "string", description: "p1, p2 ... a new id, unique on the canvas." },
                  label: { type: "string", description: "A short chip next to it, one to four words ('Subject', 'click here'). Needed for kind label." },
                  ...targetProps,
                },
                required: ["kind", "id"],
              },
            },
          },
          required: ["say", "marks"],
        },
      },
    },
    required: ["beats"],
  },
  async run({ beats }, { canvas, screen }) {
    if (!screen?.find) throw new Error("Marking the screen is not available here (macOS with Jett's screen helper only).");
    const parsed = args.safeParse({ beats });
    if (!parsed.success) throw new Error(`Nothing was marked. ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ")}`);
    const marks = parsed.data.beats.flatMap((b) => b.marks);
    for (const m of marks) {
      if (!m.text?.trim() && !m.describe?.trim()) throw new Error(`Nothing was marked. ${m.id}: give text (its words on screen) or describe.`);
      if (m.kind === "label" && !m.label) throw new Error(`Nothing was marked. ${m.id}: a label mark needs label (the chip's words).`);
    }
    // Find every target first (one lookup per distinct target), so a miss draws nothing.
    const key = (m: (typeof marks)[number]) => JSON.stringify(readTarget(m));
    const lookups = new Map<string, Promise<Found>>();
    for (const m of marks) if (!lookups.has(key(m))) lookups.set(key(m), screen.find(readTarget(m)));
    const settled = new Map<string, PromiseSettledResult<Found>>();
    await Promise.all([...lookups].map(async ([k, p]) => settled.set(k, await p.then((v) => ({ status: "fulfilled" as const, value: v }), (e) => ({ status: "rejected" as const, reason: e })))));
    const misses = marks.flatMap((m) => {
      const r = settled.get(key(m))!;
      return r.status === "rejected" ? [`${m.id}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : [];
    });
    if (misses.length) throw new Error(`Nothing was marked. ${[...new Set(misses)].slice(0, 3).join(" ")}`);
    const found = (m: (typeof marks)[number]) => (settled.get(key(m)) as PromiseFulfilledResult<Found>).value;
    const checked = parseBeats(
      parsed.data.beats.map((b) => ({
        say: b.say,
        marks: b.marks.map((m) => {
          const f = found(m);
          return { kind: "spot", id: m.id, style: m.kind, rect: f.rect, label: m.label, color: m.color, texts: f.texts, via: f.via };
        }),
      })),
    );
    canvas.draw(checked);
    screen.pin?.(marks.map((m) => m.id), found(marks[0]!).front);
    return {
      marked: marks.map((m) => ({ id: m.id, kind: m.kind, found: found(m).label ?? m.text ?? m.describe, via: found(m).via })),
      canvas: canvas.ids(),
    };
  },
});
