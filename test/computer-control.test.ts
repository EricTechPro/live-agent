// Computer control (Roamies-style, our own code): `open`, `act_in_app`, `list_windows` and
// `run_command` through the core's event stream, the `act` risk class and its risky-step rule,
// and the pure input checks (open's argv, never a shell).
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import { rule, riskyStep } from "../src/core/safety.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import type { AxHit, Eyes, FrontWindow } from "../src/screen/eyes.ts";
import { AccessibilityOffError, openArgv, type Hands } from "../src/screen/hands.ts";
import actInApp from "../tools/act-in-app.ts";
import listWindows from "../tools/list-windows.ts";
import open from "../tools/open.ts";
import runCommand from "../tools/run-command.ts";

const call = (id: string, name: string, args: Record<string, unknown>) => [{ type: "tool.call" as const, id, name, args }];
const said = (text: string) => [{ type: "text" as const, text }];
const result = (events: AgentEvent[], name: string) => events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.name === name)!;
const verdict = (events: AgentEvent[]) => events.find((e): e is EventOf<"safety.verdict"> => e.type === "safety.verdict")!;

/** Fake hands that record what they were asked to do. */
function fakeHands(options: { running?: string[]; trusted?: boolean } = {}) {
  const running = new Set(options.running ?? []);
  const did: unknown[] = [];
  const hands: Hands = {
    trusted: async () => options.trusted !== false,
    windows: async () => ({
      apps: [...running].map((app, i) => ({ app, pid: 100 + i, active: false })),
      windows: [...running].map((app, i) => ({ app, pid: 100 + i, title: `${app} window` })),
    }),
    async focus(app) {
      did.push(["focus", app]);
      if (!running.has(app)) throw new Error(`${app} is not running`);
      return { app, pid: 100 };
    },
    async press(at, pid) {
      did.push(["press", at, pid]);
      return { via: "ax", role: "AXButton" };
    },
    async clickAt(at, opts) {
      did.push(["clickAt", at, opts ?? {}]);
    },
    async type(text) {
      did.push(["type", text]);
    },
    async key(combo) {
      did.push(["key", combo]);
    },
    async scroll(direction, amount, at) {
      did.push(["scroll", direction, amount, at]);
    },
    async open(argv) {
      did.push(["open", argv]);
      const a = argv.indexOf("-a");
      if (a >= 0) running.add(argv[a + 1]!);
    },
  };
  return { hands, did };
}

const front: FrontWindow = { app: "Notes", pid: 77, windowId: 3, bounds: { x: 0, y: 25, w: 1000, h: 700 } };
const newNote: AxHit = { label: "New Note", role: "AXButton", frame: { x: 100, y: 40, w: 40, h: 20 }, exact: true };
const fakeEyes = (found: AxHit[] = [newNote]): Eyes => ({
  permission: async () => true,
  requestPermission: async () => true,
  state: async () => ({ display: { x: 0, y: 0, w: 1440, h: 900 }, front }),
  shot: async () => {
    throw new Error("no shots here");
  },
  ax: {
    trusted: async () => true,
    request: async () => true,
    find: async (text) => ({ trusted: true, matches: found.filter((f) => f.label?.toLowerCase() === text.toLowerCase()) }),
    controls: async () => ({ trusted: true, controls: found, texts: [] }),
  },
  ocr: async () => ({ lines: [], area: front.bounds! }),
});

const tools = [actInApp, listWindows, open, runCommand];

describe("open: input checks (argv only, never a shell)", () => {
  test("an app by name, a web address, a bare domain, a path", () => {
    expect(openArgv({ target: "Safari" })).toEqual(["open", "-a", "Safari"]);
    expect(openArgv({ target: "https://youtube.com/results?search_query=a b" })).toEqual(["open", "https://youtube.com/results?search_query=a b"]);
    expect(openArgv({ target: "skool.com/erictech" })).toEqual(["open", "https://skool.com/erictech"]);
    expect(openArgv({ target: "~" })).toEqual(["open", homedir()]);
    expect(openArgv({ target: "/tmp" })).toEqual(["open", "/tmp"]);
    expect(openArgv({ target: "https://x.com", app: "Google Chrome" })).toEqual(["open", "-a", "Google Chrome", "https://x.com"]);
    expect(openArgv({ target: "Notes", background: true })).toEqual(["open", "-g", "-a", "Notes"]);
  });

  test("refuses flags, shell bits, odd schemes and missing paths", () => {
    expect(() => openArgv({ target: "-n" })).toThrow();
    expect(() => openArgv({ target: "Safari; rm -rf ~" })).toThrow();
    expect(() => openArgv({ target: "$(whoami)" })).toThrow();
    expect(() => openArgv({ target: "javascript:alert(1)" })).toThrow();
    expect(() => openArgv({ target: "/no/such/place/here" })).toThrow();
    expect(() => openArgv({ target: "https://x.com", app: "-a" })).toThrow();
    expect(() => openArgv({ target: "" })).toThrow();
  });
});

describe("the act risk class", () => {
  const input = (mode: "ask-me" | "auto-edits" | "bypass", args: Record<string, unknown> = {}, overrides = {}) =>
    ({ tool: "act_in_app", args, risk: "act" as const, mode, overrides });

  test("asks first in Ask first and Auto, runs in Full access", () => {
    expect(rule(input("ask-me")).verdict).toBe("ask");
    expect(rule(input("auto-edits")).verdict).toBe("ask");
    expect(rule(input("bypass")).verdict).toBe("allow");
  });

  test("a risky click or key always asks, even in Full access and over an allow override", () => {
    const del = { steps: [{ do: "click_text", text: "Delete account" }] };
    expect(rule(input("bypass", del)).verdict).toBe("ask");
    expect(rule(input("bypass", del)).reason).toContain("Delete account");
    expect(rule(input("bypass", del, { act_in_app: "allow" })).verdict).toBe("ask");
    expect(rule(input("bypass", del, { act_in_app: "block" })).verdict).toBe("block");
    for (const text of ["Pay now", "Buy", "Send", "Submit", "Sign out", "Log out", "Purchase", "Remove"]) {
      expect(riskyStep({ steps: [{ do: "click_text", text }] })).toBe(text);
    }
    expect(riskyStep({ steps: [{ do: "click_text", describe: "the red trash button", near: "Remove from list" }] })).toBeTruthy();
    expect(riskyStep({ steps: [{ do: "key", key: "cmd+delete" }] })).toBe("cmd+delete");
    expect(riskyStep({ steps: [{ do: "key", key: "cmd+backspace" }] })).toBe("cmd+backspace");
  });

  test("ordinary steps are not risky: typed words, plain keys, words that only contain a risky one", () => {
    expect(riskyStep({ steps: [{ do: "type", text: "send me the deck" }] })).toBeUndefined();
    expect(riskyStep({ steps: [{ do: "key", key: "backspace" }, { do: "key", key: "return" }] })).toBeUndefined();
    expect(riskyStep({ steps: [{ do: "click_text", text: "Payments history" }, { do: "click_text", text: "Sender" }] })).toBeUndefined();
    expect(riskyStep({})).toBeUndefined();
    expect(rule(input("bypass", { steps: [{ do: "click_text", text: "New Note" }] })).verdict).toBe("allow");
  });

  test("through the stream: a risky act_in_app in Full access waits for a yes and does nothing", async () => {
    const { hands, did } = fakeHands({ running: ["Mail"] });
    const model = scriptedModel([call("a1", "act_in_app", { app: "Mail", steps: [{ do: "click_text", text: "Send" }] }), said("Okay to send?")]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    const events = await s.sendText("send it");
    expect(verdict(events)).toMatchObject({ name: "act_in_app", risk: "act", mode: "bypass", verdict: "ask" });
    expect(did).toEqual([]);
    await s.close();
  });
});

describe("act_in_app through the event stream", () => {
  test("launches a closed app in the background, focuses it, clicks by words, types and presses keys", async () => {
    const { hands, did } = fakeHands();
    const model = scriptedModel([
      call("a1", "act_in_app", {
        app: "Notes",
        steps: [
          { do: "click_text", text: "New Note" },
          { do: "type", text: "milk\neggs" },
          { do: "key", key: "cmd+s" },
          { do: "scroll", direction: "down", amount: 3 },
          { do: "click_at", x: 10, y: 20 },
          { do: "wait", seconds: 0.01 },
        ],
      }),
      said("Done."),
    ]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    const events = await s.sendText("make a note with milk and eggs");
    const r = result(events, "act_in_app");
    expect(r.status).toBe("ok");
    expect(did[0]).toEqual(["open", ["open", "-g", "-a", "Notes"]]);
    expect(did[1]).toEqual(["focus", "Notes"]);
    // The element's centre, in the app it was found in.
    expect(did).toContainEqual(["press", { x: 120, y: 50 }, 77]);
    expect(did).toContainEqual(["type", "milk\neggs"]);
    expect(did).toContainEqual(["key", "cmd+s"]);
    expect(did).toContainEqual(["scroll", "down", 3, undefined]);
    expect(did).toContainEqual(["clickAt", { x: 10, y: 20 }, {}]);
    expect((r.output as { done: unknown[] }).done).toHaveLength(6);
    await s.close();
  });

  test("a running app is not launched again", async () => {
    const { hands, did } = fakeHands({ running: ["Notes"] });
    const model = scriptedModel([call("a1", "act_in_app", { app: "Notes", steps: [{ do: "key", key: "cmd+n" }] }), said("Done.")]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    await s.sendText("new note");
    expect(did).toEqual([["focus", "Notes"], ["key", "cmd+n"]]);
    await s.close();
  });

  test("a step that fails stops the rest, and the model hears which step and what was done", async () => {
    const { hands, did } = fakeHands({ running: ["Notes"] });
    const model = scriptedModel([
      call("a1", "act_in_app", { app: "Notes", steps: [{ do: "key", key: "cmd+n" }, { do: "click_text", text: "Export" }, { do: "type", text: "x" }] }),
      said("I couldn't find Export."),
    ]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    const events = await s.sendText("export it");
    const r = result(events, "act_in_app");
    expect(r.status).toBe("error");
    expect(r.error).toContain("step 2");
    expect(r.error).toContain("Export");
    expect(did).not.toContainEqual(["type", "x"]);
    await s.close();
  });

  test("Accessibility off: a clear error before anything happens", async () => {
    const { hands, did } = fakeHands({ running: ["Notes"], trusted: false });
    const model = scriptedModel([call("a1", "act_in_app", { app: "Notes", steps: [{ do: "type", text: "hi" }] }), said("Turn on Accessibility.")]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    const events = await s.sendText("type hi");
    const r = result(events, "act_in_app");
    expect(r.status).toBe("error");
    expect(r.error).toBe(new AccessibilityOffError().message);
    expect(did).toEqual([]);
    await s.close();
  });

  test("bad steps are refused before anything happens", async () => {
    const { hands, did } = fakeHands({ running: ["Notes"] });
    const model = scriptedModel([call("a1", "act_in_app", { steps: [{ do: "key", key: "cmd+n" }, { do: "fly" }] }), said("Hm.")]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "bypass", chatEndNote: false });
    const r = result(await s.sendText("go"), "act_in_app");
    expect(r.status).toBe("error");
    expect(did).toEqual([]);
    await s.close();
  });

  test("asks first in Ask first mode", async () => {
    const { hands, did } = fakeHands({ running: ["Notes"] });
    const model = scriptedModel([call("a1", "act_in_app", { app: "Notes", steps: [{ do: "key", key: "cmd+n" }] }), said("Okay?")]);
    const s = await startSession({ model, tools, hands, eyes: fakeEyes(), mode: "ask-me", chatEndNote: false });
    expect(verdict(await s.sendText("new note"))).toMatchObject({ risk: "act", verdict: "ask" });
    expect(did).toEqual([]);
    await s.close();
  });
});

describe("open, list_windows and run_command through the event stream", () => {
  test("open hands the checked argv to the helper", async () => {
    const { hands, did } = fakeHands();
    const model = scriptedModel([call("o1", "open", { target: "youtube.com" }), said("Opened.")]);
    const s = await startSession({ model, tools, hands, mode: "bypass", chatEndNote: false });
    const events = await s.sendText("open youtube");
    expect(verdict(events)).toMatchObject({ risk: "act", verdict: "allow" });
    expect(result(events, "open").status).toBe("ok");
    expect(did).toEqual([["open", ["open", "https://youtube.com"]]]);
    await s.close();
  });

  test("open refuses an injection and runs nothing", async () => {
    const { hands, did } = fakeHands();
    const model = scriptedModel([call("o1", "open", { target: "Safari | say hi" }), said("No.")]);
    const s = await startSession({ model, tools, hands, mode: "bypass", chatEndNote: false });
    expect(result(await s.sendText("open it"), "open").status).toBe("error");
    expect(did).toEqual([]);
    await s.close();
  });

  test("list_windows reads the apps and windows, no yes needed", async () => {
    const { hands } = fakeHands({ running: ["Notes", "Safari"] });
    const model = scriptedModel([call("w1", "list_windows", {}), said("Notes and Safari.")]);
    const s = await startSession({ model, tools, hands, mode: "ask-me", chatEndNote: false });
    const events = await s.sendText("what's open?");
    expect(verdict(events)).toMatchObject({ risk: "read", verdict: "allow" });
    expect(result(events, "list_windows").output).toMatchObject({ apps: [{ app: "Notes" }, { app: "Safari" }] });
    await s.close();
  });

  test("run_command is a command tool and answers its output", async () => {
    const model = scriptedModel([call("r1", "run_command", { command: "echo hi && echo oops >&2 && exit 3" }), said("Done.")]);
    const s = await startSession({ model, tools, mode: "bypass", chatEndNote: false });
    const events = await s.sendText("run it");
    expect(verdict(events)).toMatchObject({ risk: "command", verdict: "allow" });
    expect(result(events, "run_command").output).toMatchObject({ exitCode: 3, stdout: "hi\n", stderr: "oops\n" });
    await s.close();
  });
});

test("the system prompt tells Jett to open and act instead of saying it can't", () => {
  const prompt = systemInstruction("short");
  expect(prompt).toContain("open");
  expect(prompt).toContain("act_in_app");
  expect(prompt).toContain("list_windows");
});
