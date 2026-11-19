// act_in_app: do things in another app for the user (computer control).
//
// The model names the app and a list of steps; code does them in order: click a control by
// its words (found by the same locator as find_on_screen, then an Accessibility press at its
// centre, else a real click), click a point, type, press keys, scroll, wait, focus. A closed
// app is launched in the background first (`open -g -a`), then brought to the front.
//
// Risk "act": Ask first and Auto ask; Full access runs it. The gate (src/core/safety.ts
// `riskyStep`) always asks for clicks or keys that could delete, pay, send or sign out.
// A step that fails stops the rest; the model hears which step and what was done before it.
// Idea from Roamies (AGPL): idea only, our own code.
import { z } from "zod";
import { errorMessage } from "../src/errors.ts";
import { defineTool, type ToolContext } from "../src/core/tool.ts";
import { AccessibilityOffError, appName, type Hands } from "../src/screen/hands.ts";
import { readTarget, targetProps } from "./find-on-screen.ts";

const MAX_STEPS = 30;
/** A moment for the UI to catch up after a click, key or focus, before the next step looks. */
const SETTLE_MS = 150;
const LAUNCH_WAIT_MS = 10_000;

const point = { x: z.number(), y: z.number() };
const stepSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("click_text"), text: z.string().optional(), describe: z.string().optional(), near: z.string().optional(), nth: z.number().optional() }),
  z.object({ do: z.literal("click_at"), ...point, right: z.boolean().optional(), count: z.number().int().min(1).max(3).optional() }),
  z.object({ do: z.literal("type"), text: z.string().min(1).max(2000) }),
  z.object({ do: z.literal("key"), key: z.string().trim().min(1).max(40) }),
  z.object({
    do: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(50).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  z.object({ do: z.literal("wait"), seconds: z.number().min(0).max(10) }),
  z.object({ do: z.literal("focus"), app: z.string().trim().min(1) }),
]);
type Step = z.infer<typeof stepSchema>;
const argsSchema = z.object({ app: z.string().trim().min(1).optional(), steps: z.array(stepSchema).min(1).max(MAX_STEPS) });

const INPUT_STEPS = new Set(["click_text", "click_at", "type", "key", "scroll"]);

/** "click_text "Export"", "key cmd+s": a step in a few words, for the model's error. */
function name(step: Step): string {
  switch (step.do) {
    case "click_text":
      return `click_text "${step.text ?? step.describe ?? ""}"`;
    case "click_at":
      return `click_at ${step.x},${step.y}`;
    case "type":
      return `type "${step.text.length > 30 ? `${step.text.slice(0, 30)}...` : step.text}"`;
    case "key":
      return `key ${step.key}`;
    case "scroll":
      return `scroll ${step.direction}`;
    case "wait":
      return `wait ${step.seconds}s`;
    case "focus":
      return `focus ${step.app}`;
  }
}

const same = (a: string, b?: string) => !!b && a.toLowerCase() === b.toLowerCase();

/** Make sure the app is running (launch it in the background if not), then bring it to the front. */
async function bringUp(hands: Hands, app: string): Promise<{ launched: boolean }> {
  const wanted = appName(app);
  const running = async () => (await hands.windows()).apps.some((a) => same(wanted, a.app) || same(wanted, a.bundleId));
  let launched = false;
  if (!(await running())) {
    await hands.open(["open", "-g", "-a", wanted]);
    launched = true;
    const until = Date.now() + LAUNCH_WAIT_MS;
    while (!(await running())) {
      if (Date.now() > until) throw new Error(`${wanted} did not start.`);
      await Bun.sleep(300);
    }
  }
  await hands.focus(wanted);
  await Bun.sleep(launched ? 600 : SETTLE_MS);
  return { launched };
}

async function doStep(step: Step, hands: Hands, screen: ToolContext["screen"]): Promise<Record<string, unknown>> {
  switch (step.do) {
    case "click_text": {
      if (!step.text?.trim() && !step.describe?.trim()) throw new Error("give text (its words on screen) or describe");
      if (!screen?.find) throw new Error("finding things on screen is not available here");
      const found = await screen.find(readTarget(step));
      const r = found.rect;
      const pressed = await hands.press({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, found.front?.pid);
      await Bun.sleep(SETTLE_MS);
      return { clicked: found.label ?? step.text ?? step.describe, via: pressed.via };
    }
    case "click_at":
      await hands.clickAt({ x: step.x, y: step.y }, { ...(step.right ? { right: true } : {}), ...(step.count ? { count: step.count } : {}) });
      await Bun.sleep(SETTLE_MS);
      return { clicked: { x: step.x, y: step.y } };
    case "type":
      await hands.type(step.text);
      return { typed: step.text.length };
    case "key":
      await hands.key(step.key);
      await Bun.sleep(SETTLE_MS);
      return { pressed: step.key };
    case "scroll": {
      const at = step.x !== undefined && step.y !== undefined ? { x: step.x, y: step.y } : undefined;
      await hands.scroll(step.direction, step.amount ?? 5, at);
      return { scrolled: step.direction };
    }
    case "wait":
      await Bun.sleep(step.seconds * 1000);
      return { waited: step.seconds };
    case "focus":
      await bringUp(hands, step.app);
      return { focused: step.app };
  }
}

export default defineTool<Record<string, unknown>>({
  name: "act_in_app",
  description:
    "Do things in an app on the user's Mac for them: click buttons, links and tabs, type, press keys, scroll. Put the " +
    "whole task in one call; steps run in order. app: the app to act in (it is opened if closed and brought to the " +
    "front). Steps: {do:'click_text', text} clicks a control by its exact words on screen (or describe: what it looks " +
    "like; near/nth to choose between two); {do:'type', text} types into the field that has focus (click it first; " +
    "'\\n' presses Return); {do:'key', key} e.g. 'return', 'tab', 'escape', 'cmd+t', 'cmd+shift+n'; {do:'scroll', " +
    "direction, amount}; {do:'click_at', x, y} screen points, last resort; {do:'wait', seconds}; {do:'focus', app}. " +
    "To go to a website, use open instead. Never delete, pay, buy, send or sign out unless the user clearly asked for " +
    "exactly that; those clicks always ask the user first, so just call it and the app asks them. If a step fails you " +
    "hear which one: say so in one line, or look and try other words.",
  risk: "act",
  parameters: {
    type: "object",
    properties: {
      app: { type: "string", description: "The app to act in, by name ('Notes', 'Google Chrome'). Leave out to act in the front app." },
      steps: {
        type: "array",
        description: "The steps, in order.",
        items: {
          type: "object",
          properties: {
            do: { type: "string", enum: ["click_text", "click_at", "type", "key", "scroll", "wait", "focus"] },
            ...targetProps,
            x: { type: "number", description: "click_at / scroll: screen points." },
            y: { type: "number", description: "click_at / scroll: screen points." },
            right: { type: "boolean", description: "click_at: right click." },
            count: { type: "integer", description: "click_at: 2 = double click." },
            key: { type: "string", description: "key: 'return', 'tab', 'escape', 'cmd+t' ..." },
            direction: { type: "string", enum: ["up", "down", "left", "right"], description: "scroll." },
            amount: { type: "integer", description: "scroll: lines (default 5)." },
            seconds: { type: "number", description: "wait: at most 10." },
            app: { type: "string", description: "focus: the app to bring to the front." },
          },
          required: ["do"],
        },
      },
    },
    required: ["steps"],
  },
  async run(args, { hands, screen }) {
    if (!hands) throw new Error("Acting in other apps is not available here (macOS with Jett's screen helper only).");
    const parsed = argsSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Nothing was done. ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join("; ")}`);
    }
    const { app, steps } = parsed.data;
    if (app) appName(app);
    if (steps.some((s) => INPUT_STEPS.has(s.do)) && !(await hands.trusted())) throw new AccessibilityOffError();

    const done: Record<string, unknown>[] = [];
    let launched = false;
    if (app) launched = (await bringUp(hands, app)).launched;
    for (const [i, step] of steps.entries()) {
      try {
        done.push(await doStep(step, hands, screen));
      } catch (err) {
        const before = done.length ? ` Done before it: ${steps.slice(0, i).map(name).join(", ")}.` : " Nothing else was done.";
        throw new Error(`step ${i + 1} (${name(step)}) failed: ${errorMessage(err)}.${before}`);
      }
    }
    return {
      ...(app ? { app, ...(launched ? { launched: true } : {}) } : {}),
      done,
      check: "If it matters whether it worked, call look before saying it is done.",
    };
  },
});
