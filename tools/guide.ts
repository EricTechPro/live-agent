// guide: "show me how to export this". Jett teaches instead of doing: for each step it rings
// the real control on screen, says the step, and waits for the user's own click on it before
// the next one. Esc (or "stop", which calls guide with stop: true) ends it.
//
// The ring is a `spot` mark (the same canvas and pen as mark_screen); the click comes from
// Jett's eyes (`watch`, src/screen/eyes.ts). Each step is told to the model as an early answer
// (`tell`), so the voice says it at that moment. Risk "read": it only draws and waits.
// Idea from Roamies (AGPL): idea only, our own code.
import { z } from "zod";
import { parseBeats } from "../src/core/canvas.ts";
import { defineTool } from "../src/core/tool.ts";
import type { Pt, Rect } from "../src/screen/geometry.ts";
import { readTarget, targetProps } from "./find-on-screen.ts";

/** How near the target a click counts (points), and how long a step waits. Tests change these. */
export const guideTiming = { pad: 24, timeoutMs: 120_000 };

const args = z.object({
  steps: z
    .array(z.object({ say: z.string().trim().min(1).max(200), text: z.string().optional(), describe: z.string().optional(), near: z.string().optional(), nth: z.number().optional() }))
    .min(1)
    .max(12)
    .optional(),
  stop: z.boolean().optional(),
});

/** The guide running now: a second guide, or stop: true, ends it. */
let active: AbortController | undefined;

const inside = (p: Pt, r: Rect, pad: number) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;

/** The next free mark id (p1, p2 ...) on the canvas. */
function freeId(ids: string[]): string {
  const top = Math.max(0, ...ids.map((id) => Number(id.slice(1))).filter(Number.isFinite));
  return `p${top + 1}`;
}

type Wait = "clicked" | "stopped" | "timeout";

export default defineTool<Record<string, unknown>>({
  name: "guide",
  description:
    "Show the user how to do something themselves, step by step, on their real screen ('show me how', 'teach me', " +
    "'walk me through'). Each step: the control to click, by its words on screen (text) or looks (describe), and say: " +
    "the step in one short line ('Click Export, top right'). Jett rings it, you say the step when you hear it, and the " +
    "next step comes once the user has clicked it. Only steps visible now or right after the previous click. If the " +
    "user says stop, call guide with stop: true. To do it for them instead, use act_in_app.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        description: "The steps, in order.",
        items: { type: "object", properties: { say: { type: "string", description: "The step in one short spoken line." }, ...targetProps }, required: ["say"] },
      },
      stop: { type: "boolean", description: "true: stop the guide that is running." },
    },
  },
  async run(raw, { screen, canvas, emit, tell, signal }) {
    const parsed = args.safeParse(raw);
    if (!parsed.success) throw new Error(`Nothing was shown. ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ")}`);
    if (parsed.data.stop) {
      const was = !!active;
      active?.abort();
      return { stopped: was };
    }
    const steps = parsed.data.steps;
    if (!steps?.length) throw new Error("give steps, or stop: true");
    if (!screen?.find || !screen.watch) throw new Error("Guiding on screen is not available here (macOS with Jett's screen helper only).");
    for (const [i, s] of steps.entries()) if (!s.text?.trim() && !s.describe?.trim()) throw new Error(`Nothing was shown. step ${i + 1}: give text (its words on screen) or describe.`);

    active?.abort();
    const mine = new AbortController();
    active = mine;
    signal?.addEventListener("abort", () => mine.abort(), { once: true });

    // One click watcher for the whole guide; each step waits on it.
    let onClick: ((at: Pt) => void) | undefined;
    const stopWatch = screen.watch((e) => e.type === "click" && onClick?.(e.at));
    const of = steps.length;
    let mark: string | undefined;
    const erase = () => {
      if (mark && canvas.ids().includes(mark)) canvas.change({ edits: [], erase: [mark] });
      mark = undefined;
    };
    try {
      for (const [i, s] of steps.entries()) {
        if (mine.signal.aborted) return { stopped: true, step: i + 1, of };
        let rect: Rect;
        try {
          rect = (await screen.find(readTarget(s))).rect;
        } catch (err) {
          return {
            stoppedAt: i + 1,
            of,
            error: `step ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
            instruction: "Tell the user you can't see that control right now, in one short line, and ask what they see.",
          };
        }
        mark = freeId(canvas.ids());
        canvas.draw(parseBeats([{ say: s.say, marks: [{ kind: "spot", id: mark, style: "ring", rect, label: `${i + 1}/${of}` }] }]));
        emit?.({ type: "act.step", tool: "guide", step: i + 1, of, say: s.say, rect, state: "waiting" });
        tell?.({
          step: i + 1,
          of,
          say: s.say,
          instruction: "Say this step to the user now, in one short sentence, then stop and wait: you hear when they have clicked it. If they say stop, call guide with stop: true.",
        });
        const got = await new Promise<Wait>((resolve) => {
          const timer = setTimeout(() => resolve("timeout"), guideTiming.timeoutMs);
          const end = (w: Wait) => {
            clearTimeout(timer);
            onClick = undefined;
            resolve(w);
          };
          if (mine.signal.aborted) return end("stopped");
          mine.signal.addEventListener("abort", () => end("stopped"), { once: true });
          onClick = (at) => inside(at, rect, guideTiming.pad) && end("clicked");
        });
        erase();
        emit?.({ type: "act.step", tool: "guide", step: i + 1, of, say: s.say, rect, state: "done" });
        if (got === "stopped") return { stopped: true, step: i + 1, of, instruction: "The user stopped the guide. Say OK in a few words." };
        if (got === "timeout") return { timedOut: true, step: i + 1, of, instruction: "The user did not click it. Ask in one short line whether they want to carry on." };
      }
      return { done: true, steps: of, instruction: "Every step is done. Say so in one short line." };
    } finally {
      erase();
      stopWatch();
      if (active === mine) active = undefined;
    }
  },
});
