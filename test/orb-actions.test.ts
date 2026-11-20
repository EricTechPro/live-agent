// Batch 2 (gap scan): the orb's act steps, reminders, memory + forget, guided steps and
// ducking the Mac, through the agent core's event stream (scripted fake model, fake eyes
// and hands). Roamies ideas, our own code.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type Config } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent, ModelInput } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import type { AxHit, Eyes, FrontWindow, WatchEvent } from "../src/screen/eyes.ts";
import type { Hands } from "../src/screen/hands.ts";
import { addReminder, loadReminders, parseWhen } from "../src/reminders.ts";
import { listFacts } from "../src/brain/memory.ts";
import { createDuck, type Volume } from "../src/duck.ts";
import actInApp, { actTiming } from "../tools/act-in-app.ts";
import doneReminder from "../tools/done-reminder.ts";
import forget from "../tools/forget.ts";
import guide, { guideTiming } from "../tools/guide.ts";
import listReminders from "../tools/list-reminders.ts";
import remember from "../tools/remember.ts";
import remind from "../tools/remind.ts";
import snoozeReminder from "../tools/snooze-reminder.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-orb-actions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function brain() {
  const b = join(dir, `brain-${n++}`);
  mkdirSync(join(b, "raw"), { recursive: true });
  return b;
}
const config = (brainPath: string, more: Partial<Config> = {}): Config => ({ ...defaultConfig(), brainPath, ...more });

const call = (id: string, name: string, args: Record<string, unknown>): ModelEvent[] => [{ type: "tool.call", id, name, args }];
const said = (text: string): ModelEvent[] => [{ type: "text", text }];
const result = (events: AgentEvent[], name: string) => events.findLast((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.name === name && e.status !== "waiting")!;
const steps = (events: AgentEvent[]) => events.filter((e): e is EventOf<"act.step"> => e.type === "act.step");
const tools = [actInApp, remind, listReminders, doneReminder, snoozeReminder, remember, forget, guide];

const front: FrontWindow = { app: "CapCut", pid: 77, windowId: 3, bounds: { x: 0, y: 25, w: 1400, h: 850 } };
const scale: AxHit = { label: "Scale", role: "AXTextField", frame: { x: 1200, y: 210, w: 60, h: 20 }, exact: true };
const exportBtn: AxHit = { label: "Export", role: "AXButton", frame: { x: 1300, y: 40, w: 60, h: 24 }, exact: true };

/** Fake eyes: Accessibility finds `found`; `click(at)` plays a click to every watcher. */
function fakeEyes(found: AxHit[] = [scale, exportBtn]) {
  const watchers = new Set<(e: WatchEvent) => void>();
  const eyes: Eyes = {
    permission: async () => true,
    requestPermission: async () => true,
    state: async () => ({ display: { x: 0, y: 0, w: 1440, h: 900 }, front }),
    shot: async () => {
      throw new Error("no shots here");
    },
    watch(on) {
      watchers.add(on);
      return () => watchers.delete(on);
    },
    ax: {
      trusted: async () => true,
      request: async () => true,
      find: async (text) => ({ trusted: true, matches: found.filter((f) => f.label?.toLowerCase() === text.toLowerCase()) }),
      controls: async () => ({ trusted: true, controls: found, texts: [] }),
    },
    ocr: async () => ({ lines: [], area: front.bounds! }),
  };
  return { eyes, click: (at: { x: number; y: number }) => watchers.forEach((w) => w({ type: "click", at })) };
}

function fakeHands(did: unknown[] = []): Hands {
  return {
    trusted: async () => true,
    windows: async () => ({ apps: [{ app: "CapCut", pid: 77 }], windows: [] }),
    focus: async (app) => (did.push(["focus", app]), { app, pid: 77 }),
    press: async (at, pid) => (did.push(["press", at, pid]), { via: "ax" }),
    clickAt: async (at) => void did.push(["clickAt", at]),
    type: async (text) => void did.push(["type", text]),
    key: async (combo) => void did.push(["key", combo]),
    scroll: async () => {},
    open: async () => {},
  };
}

beforeAll(() => {
  actTiming.leadMs = 30;
  actTiming.travelMs = 0;
  actTiming.holdMs = 0;
});

describe("act_in_app: the orb goes where it works and narrates first", () => {
  test("each step is an act.step at the control's rect with its say, start before the click and done after", async () => {
    const did: unknown[] = [];
    const model = scriptedModel([
      call("a1", "act_in_app", {
        app: "CapCut",
        steps: [
          { do: "click_text", text: "Scale", say: "Scale is on the right panel, so I'll set it to 200." },
          { do: "type", text: "200\n" },
        ],
      }),
      said("Done."),
    ]);
    const s = await startSession({ model, tools, hands: fakeHands(did), eyes: fakeEyes().eyes, mode: "bypass", chatEndNote: false, config: config(brain()) });
    const order: string[] = [];
    s.onEvent((e) => e.type === "act.step" && order.push(`${e.step}:${e.state}:${did.length}`));
    const events = await s.sendText("scale this up to 200%");
    const st = steps(events);
    expect(st[0]).toMatchObject({ id: "a1", tool: "act_in_app", app: "CapCut", step: 1, of: 2, state: "start", say: "Scale is on the right panel, so I'll set it to 200.", rect: scale.frame });
    // Step 1 starts before its press (did holds only the focus), ends after it.
    expect(order).toEqual(["1:start:1", "1:done:2", "2:start:2", "2:done:3"]);
    // The typing step keeps the orb by the field it typed into.
    expect(st[2]).toMatchObject({ step: 2, rect: scale.frame });
    // The orb's steps all come before the call's result (which sends it home).
    expect(events.indexOf(st.at(-1)!)).toBeLessThan(events.indexOf(result(events, "act_in_app")));
    await s.close();
  });

  test("the bubble leads the action by actTiming.leadMs when a step has a say", async () => {
    const did: unknown[] = [];
    const model = scriptedModel([call("a1", "act_in_app", { steps: [{ do: "key", key: "cmd+s", say: "Saving it." }] }), said("Saved.")]);
    const s = await startSession({ model, tools, hands: fakeHands(did), eyes: fakeEyes().eyes, mode: "bypass", chatEndNote: false, config: config(brain()) });
    let startAt = 0;
    let keyAt = 0;
    s.onEvent((e) => e.type === "act.step" && e.state === "start" && (startAt = performance.now()));
    s.onEvent((e) => e.type === "act.step" && e.state === "done" && (keyAt = performance.now()));
    await s.sendText("save");
    expect(keyAt - startAt).toBeGreaterThanOrEqual(25);
    await s.close();
  });

  test("a failed step is an act.step failed", async () => {
    const model = scriptedModel([call("a1", "act_in_app", { steps: [{ do: "click_text", text: "Nope" }] }), said("Couldn't.")]);
    const s = await startSession({ model, tools, hands: fakeHands(), eyes: fakeEyes().eyes, mode: "bypass", chatEndNote: false, config: config(brain()) });
    const events = await s.sendText("click nope");
    expect(steps(events).map((e) => e.state)).toEqual(["failed"]);
    expect(result(events, "act_in_app").status).toBe("error");
    await s.close();
  });

  test("Esc (stopReply) during the lead stops it before it acts", async () => {
    const did: unknown[] = [];
    const model = scriptedModel([call("a1", "act_in_app", { steps: [{ do: "key", key: "cmd+s", say: "Saving." }, { do: "key", key: "cmd+w" }] }), said("Stopped.")]);
    const s = await startSession({ model, tools, hands: fakeHands(did), eyes: fakeEyes().eyes, mode: "bypass", chatEndNote: false, config: config(brain()) });
    s.onEvent((e) => e.type === "act.step" && e.state === "start" && s.stopReply());
    const events = await s.sendText("save and close");
    expect(did).toEqual([]);
    expect(result(events, "act_in_app").error).toContain("stopped by the user");
    await s.close();
  });
});

describe("reminders", () => {
  const now = new Date(2026, 10, 19, 14, 0); // Thu 19 Nov 2026, 2 pm

  test("plain-word times", () => {
    expect(parseWhen("in 3 hours", now).getHours()).toBe(17);
    expect(parseWhen("in 20 minutes", now).getMinutes()).toBe(20);
    expect(parseWhen("in an hour", now).getHours()).toBe(15);
    expect(parseWhen("at 5pm", now).getHours()).toBe(17);
    expect(parseWhen("5:30 pm", now)).toEqual(new Date(2026, 10, 19, 17, 30));
    // A clock time already gone today is tomorrow.
    expect(parseWhen("at 9am", now)).toEqual(new Date(2026, 10, 20, 9, 0));
    expect(parseWhen("tomorrow at 9", now)).toEqual(new Date(2026, 10, 20, 9, 0));
    expect(parseWhen("tonight at 8", now)).toEqual(new Date(2026, 10, 19, 20, 0));
    expect(parseWhen("friday 10am", now)).toEqual(new Date(2026, 10, 20, 10, 0));
    expect(parseWhen("thursday 10am", now)).toEqual(new Date(2026, 10, 26, 10, 0));
    expect(() => parseWhen("sometime soon", now)).toThrow("in 3 hours");
  });

  test("remind saves it in the brain and opens the card; list, snooze and done change it", async () => {
    const b = brain();
    const model = scriptedModel([
      call("r1", "remind", { text: "Go to the gym", when: "in 3 hours" }),
      said("Done. I'll nudge you about the gym in 3 hours."),
      call("r2", "list_reminders", {}),
      said("One reminder."),
      call("r3", "snooze_reminder", { id: "gym", minutes: 30 }),
      said("Snoozed."),
      call("r4", "done_reminder", { id: "gym" }),
      said("Ticked off."),
    ]);
    const s = await startSession({ model, tools, mode: "bypass", chatEndNote: false, config: config(b) });
    let events = await s.sendText("nudge me in 3 hours to go to the gym");
    const card = events.find((e): e is EventOf<"reminders"> => e.type === "reminders")!;
    expect(card.show).toBe(true);
    expect(card.items).toHaveLength(1);
    expect(card.items[0]).toMatchObject({ text: "Go to the gym" });
    expect(existsSync(join(b, ".reminders.json"))).toBe(true);
    const due = new Date(card.items[0]!.due).getTime();
    expect(Math.abs(due - (Date.now() + 3 * 3600_000))).toBeLessThan(60_000);

    events = await s.sendText("what are my reminders");
    expect((result(events, "list_reminders").output as { reminders: { text: string }[] }).reminders[0]!.text).toBe("Go to the gym");

    await s.sendText("snooze the gym one");
    expect(Math.abs(new Date((await loadReminders(b))[0]!.due).getTime() - (Date.now() + 30 * 60_000))).toBeLessThan(60_000);

    events = await s.sendText("I went");
    expect(events.find((e): e is EventOf<"reminders"> => e.type === "reminders")!.items).toEqual([]);
    expect((await loadReminders(b))[0]!.done).toBe(true);
    await s.close();
  });

  test("a due reminder opens the card and the model nudges out loud, even before anyone spoke", async () => {
    const b = brain();
    await addReminder(b, { text: "Reply to emails", when: "in 1 minute" }, new Date(Date.now() - 5 * 60_000));
    const inputs: ModelInput[] = [];
    const model = scriptedModel([said("Hey, time to reply to your emails.")], { inputs });
    const s = await startSession({ model, tools, chatEndNote: false, config: config(b), schedule: { tickMs: 20 } });
    const fired = new Promise<EventOf<"reminders">>((resolve) => s.onEvent((e) => e.type === "reminders" && e.due && resolve(e)));
    const card = await fired;
    expect(card.show).toBe(true);
    expect(card.items[0]!.text).toBe("Reply to emails");
    await Bun.sleep(30);
    expect(inputs.find((i) => i.type === "text")).toMatchObject({ text: expect.stringContaining('Reminder due now: "Reply to emails"') });
    // It nudges once, and stays open (fired) until ticked.
    await Bun.sleep(60);
    expect(inputs.filter((i) => i.type === "text")).toHaveLength(1);
    expect(await s.reminders.list()).toMatchObject([{ text: "Reply to emails", fired: true }]);
    expect(await s.reminders.done(card.items[0]!.id)).toEqual([]);
    await s.close();
  });

  test("a repeating reminder moves on to its next time when it fires", async () => {
    const b = brain();
    const r = await addReminder(b, { text: "Stand up", every: "* * * * *" }, new Date(Date.now() - 3 * 60_000));
    const s = await startSession({ model: scriptedModel([said("Stand up!")]), tools, chatEndNote: false, config: config(b), schedule: { tickMs: 20 } });
    await new Promise((resolve) => s.onEvent((e) => e.type === "reminders" && e.due && resolve(e)));
    const after = (await loadReminders(b)).find((x) => x.id === r.id)!;
    expect(new Date(after.due).getTime()).toBeGreaterThan(Date.now());
    expect(after.fired).toBeUndefined();
    await s.close();
  });
});

describe("memory: what Jett remembers, and forget", () => {
  test("remember adds a fact (memory event); forget drops it and its raw note", async () => {
    const b = brain();
    const model = scriptedModel([
      call("m1", "remember", { text: "The gate code is 4512", title: "Gate code" }),
      said("Saved."),
      call("m2", "forget", { what: "gate code" }),
      said("Forgotten."),
    ]);
    const s = await startSession({ model, tools, mode: "bypass", chatEndNote: false, config: config(b) });
    let events = await s.sendText("remember the gate code is 4512");
    const mem = events.find((e): e is EventOf<"memory"> => e.type === "memory")!;
    expect(mem.facts.map((f) => f.text)).toEqual(["The gate code is 4512"]);
    const note = mem.facts[0]!.path!;
    expect(existsSync(join(b, note))).toBe(true);

    events = await s.sendText("forget the gate code");
    expect(result(events, "forget").output).toEqual({ forgot: "The gate code is 4512" });
    expect(events.find((e): e is EventOf<"memory"> => e.type === "memory")!.facts).toEqual([]);
    expect(existsSync(join(b, note))).toBe(false);
    await s.close();
  });

  test("the Brain tab's Forget (session.memory) and an unclear forget", async () => {
    const b = brain();
    const model = scriptedModel([
      call("m1", "remember", { text: "Likes ambient music" }),
      said("Saved."),
      call("m2", "remember", { text: "Likes ambient lamps" }),
      said("Saved."),
      call("m3", "forget", { what: "ambient" }),
      said("Which one?"),
    ]);
    const s = await startSession({ model, tools, mode: "bypass", chatEndNote: false, config: config(b) });
    await s.sendText("remember I like ambient music");
    await s.sendText("remember I like ambient lamps");
    const events = await s.sendText("forget the ambient thing");
    expect(result(events, "forget").error).toContain("matches 2 facts");
    const [first] = await s.memory.list();
    const left = await s.memory.forget(first!.id);
    expect(left.map((f) => f.text)).toEqual(["Likes ambient lamps"]);
    expect((await listFacts(b)).length).toBe(1);
    await s.close();
  });
});

describe("guide: ring it, say it, wait for the user's click", () => {
  test("each step is ringed and told to the model; the next comes only after a click on it", async () => {
    guideTiming.timeoutMs = 2000;
    const { eyes, click } = fakeEyes();
    const inputs: ModelInput[] = [];
    const model = scriptedModel(
      [
        call("g1", "guide", { steps: [{ text: "Scale", say: "Click the Scale field." }, { text: "Export", say: "Now click Export, top right." }] }),
        said("Click the Scale field."),
        said("Now click Export, top right."),
        said("That's all it takes."),
      ],
      { inputs },
    );
    const s = await startSession({ model, tools, eyes, chatEndNote: false, config: config(brain()) });
    const seen: string[] = [];
    s.onEvent((e) => {
      if (e.type !== "act.step") return;
      seen.push(`${e.step}:${e.state}`);
      if (e.state !== "waiting") return;
      // A click somewhere else first: nothing happens. Then one on the target.
      setTimeout(() => click({ x: 10, y: 10 }), 5);
      setTimeout(() => click({ x: e.rect!.x + 5, y: e.rect!.y + 5 }), 20);
    });
    const events = await s.sendText("show me how to export");
    expect(seen).toEqual(["1:waiting", "1:done", "2:waiting", "2:done"]);
    // The ring for each step was a spot mark, erased once clicked.
    const beats = events.filter((e): e is EventOf<"canvas.beat"> => e.type === "canvas.beat");
    expect(beats.map((b) => b.marks[0])).toMatchObject([{ kind: "spot", style: "ring", rect: scale.frame }, { kind: "spot", style: "ring", rect: exportBtn.frame }]);
    expect(events.filter((e) => e.type === "canvas.erase")).toHaveLength(2);
    // Two early answers (one per step), then the last one.
    const answers = inputs.filter((i): i is Extract<ModelInput, { type: "tool.response" }> => i.type === "tool.response");
    expect(answers.map((a) => [a.willContinue ?? false, (a.response.output as { say?: string; done?: boolean }).say ?? "end"])).toEqual([
      [true, "Click the Scale field."],
      [true, "Now click Export, top right."],
      [false, "end"],
    ]);
    expect(result(events, "guide").output).toMatchObject({ done: true, steps: 2 });
    await s.close();
  });

  test("Esc stops a guide that is waiting", async () => {
    const { eyes } = fakeEyes();
    const model = scriptedModel([call("g1", "guide", { steps: [{ text: "Export", say: "Click Export." }] }), said("Click Export."), said("OK.")]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false, config: config(brain()) });
    s.onEvent((e) => e.type === "act.step" && e.state === "waiting" && setTimeout(() => s.stopReply(), 10));
    const events = await s.sendText("show me how to export");
    expect(result(events, "guide").output).toMatchObject({ stopped: true, step: 1 });
    await s.close();
  });

  test("a target that is not on screen stops before anything is drawn", async () => {
    const { eyes } = fakeEyes();
    const model = scriptedModel([call("g1", "guide", { steps: [{ text: "Nowhere", say: "Click Nowhere." }] }), said("I can't see it.")]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false, config: config(brain()) });
    const events = await s.sendText("show me");
    expect(result(events, "guide").output).toMatchObject({ stoppedAt: 1 });
    expect(events.some((e) => e.type === "canvas.beat")).toBe(false);
    await s.close();
  });
});

describe("duck the Mac while talking", () => {
  function fakeVolume(start = 60) {
    const sets: number[] = [];
    let level = start;
    const volume: Volume = { get: async () => level, set: async (v) => void (sets.push(v), (level = v)) };
    return { volume, sets, level: () => level };
  }

  test("quiet while held, the exact level back after; the level is kept on disk meanwhile", async () => {
    const v = fakeVolume(63);
    const stateFile = join(dir, "duck-1.json");
    const duck = createDuck({ volume: v.volume, stateFile });
    await duck.set(true);
    expect(v.level()).toBeLessThan(15);
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({ volume: 63 });
    await duck.set(true); // a second press changes nothing
    await duck.set(false);
    expect(v.level()).toBe(63);
    expect(existsSync(stateFile)).toBe(false);
  });

  test("a crash mid-hold: the next start puts the level back", async () => {
    const stateFile = join(dir, "duck-2.json");
    writeFileSync(stateFile, JSON.stringify({ volume: 41 }));
    const v = fakeVolume(6);
    await createDuck({ volume: v.volume, stateFile }).recover();
    expect(v.level()).toBe(41);
    expect(existsSync(stateFile)).toBe(false);
  });

  test("the session ducks only with duckWhileTalking on, and restores on close", async () => {
    const v = fakeVolume(50);
    const duck = createDuck({ volume: v.volume, stateFile: join(dir, "duck-3.json") });
    const off = await startSession({ model: scriptedModel([]), tools, chatEndNote: false, duck, config: config(brain(), { duckWhileTalking: false }) });
    await off.duck(true);
    expect(v.sets).toEqual([]);
    await off.close();
    const on = await startSession({ model: scriptedModel([]), tools, chatEndNote: false, duck, config: config(brain()) });
    await on.duck(true);
    expect(v.level()).toBeLessThan(50);
    await on.close();
    expect(v.level()).toBe(50);
  });
});
