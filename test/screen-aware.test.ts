// Screen awareness through the core's event stream (slices 1 and 2): the `look` tool, the
// [Screen: ...] context line, circling while holding Ctrl+Option, and Screen Recording off.
// The helper is a fake `Eyes`; the model is scripted and logs every input it gets.
import { describe, expect, test } from "bun:test";
import type { LiveConnectParameters, LiveSendRealtimeInputParameters } from "@google/genai";
import { isVoice, startSession } from "../src/core/agent.ts";
import type { ModelInput } from "../src/core/model.ts";
import { ScreenPermissionError, type Eyes, type ShotOptions } from "../src/screen/eyes.ts";
import type { Pt } from "../src/screen/geometry.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import look from "../tools/look.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function fakeEyes({ allowed = true } = {}) {
  const shots: ShotOptions[] = [];
  const eyes: Eyes = {
    permission: async () => allowed,
    requestPermission: async () => allowed,
    state: async () => ({
      display: { x: 0, y: 0, w: 1512, h: 982 },
      front: { app: "Google Chrome", pid: 42, title: "Pigs - Wikipedia", url: "https://en.wikipedia.org/wiki/Pig" },
    }),
    async shot(options = {}) {
      if (!allowed) throw new ScreenPermissionError();
      shots.push(options);
      const r = options.rect ?? { x: 0, y: 0, w: 1512, h: 982 };
      return { jpeg: JPEG, map: { origin: { x: r.x, y: r.y }, size: { w: r.w, h: r.h }, px: { w: r.w * 2, h: r.h * 2 } } };
    },
  };
  return { eyes, shots };
}

// A recorded circle drawn round something near the top left (global points), with a run-up.
const circlePath: Pt[] = [
  { x: 120, y: 260 }, { x: 140, y: 230 },
  ...Array.from({ length: 33 }, (_, k) => {
    const a = (k / 32) * 2 * Math.PI * 1.05;
    return { x: 200 + 50 * Math.cos(a), y: 150 + 40 * Math.sin(a) };
  }),
];
const threeQuarters: Pt[] = Array.from({ length: 25 }, (_, k) => {
  const a = (k / 24) * 1.5 * Math.PI;
  return { x: 700 + 60 * Math.cos(a), y: 500 + 60 * Math.sin(a) };
});

describe("look: Jett sees the screen when it asks", () => {
  test("the screenshot goes in as an image before the tool's answer", async () => {
    const inputs: ModelInput[] = [];
    const model = scriptedModel(
      [
        [{ type: "tool.call", id: "c1", name: "look", args: {} }],
        [{ type: "text", text: "That's a Wikipedia page about pigs." }],
      ],
      { inputs },
    );
    const { eyes, shots } = fakeEyes();
    const session = await startSession({ model, tools: [look], eyes, chatEndNote: false });

    const events = await session.sendText("what am I looking at?");

    expect(shots).toEqual([{}]); // the whole screen, once
    const shot = events.find((e) => e.type === "screen.shot");
    expect(shot).toMatchObject({ type: "screen.shot", reason: "look", width: 3024, height: 1964 });
    const result = events.find((e) => e.type === "tool.result");
    expect(result).toMatchObject({ status: "ok", output: { app: "Google Chrome", url: "https://en.wikipedia.org/wiki/Pig" } });
    expect(inputs.map((i) => i.type)).toEqual(["text", "image", "tool.response"]);
    await session.close();
  });

  test("Screen Recording off: the window is told, and the model hears it can't see", async () => {
    const model = scriptedModel([
      [{ type: "tool.call", id: "c1", name: "look", args: {} }],
      [{ type: "text", text: "I can't see your screen yet." }],
    ]);
    const session = await startSession({ model, tools: [look], eyes: fakeEyes({ allowed: false }).eyes, chatEndNote: false });

    const events = await session.sendText("what's this?");

    expect(events.find((e) => e.type === "screen.permission")).toMatchObject({ granted: false });
    const result = events.find((e) => e.type === "tool.result");
    expect(result).toMatchObject({ status: "error" });
    expect((result as { error: string }).error).toContain("Screen Recording");
    await session.close();
  });

  test("with no eyes the tool says so instead of guessing", async () => {
    const model = scriptedModel([[{ type: "tool.call", id: "c1", name: "look", args: {} }], [{ type: "text", text: "ok" }]]);
    const session = await startSession({ model, tools: [look], chatEndNote: false });
    const events = await session.sendText("what's this?");
    expect(events.find((e) => e.type === "tool.result")).toMatchObject({ status: "error" });
    await session.close();
  });
});

describe("every turn carries the front app as text", () => {
  test("a typed turn gets the [Screen: ...] line; the transcript keeps the user's words", async () => {
    const inputs: ModelInput[] = [];
    const model = scriptedModel([[{ type: "text", text: "Sure." }]], { inputs });
    const session = await startSession({ model, tools: [], eyes: fakeEyes().eyes, chatEndNote: false });

    const events = await session.sendText("summarise this page");

    expect(inputs[0]).toEqual({
      type: "text",
      text:
        '[Screen: front app Google Chrome, window "Pigs - Wikipedia", https://en.wikipedia.org/wiki/Pig · screen 1512x982 points]\n' +
        "summarise this page",
    });
    expect(events[0]).toEqual({ type: "transcript", role: "user", text: "summarise this page" });
    await session.close();
  });

  test("without eyes the text goes in untouched", async () => {
    const inputs: ModelInput[] = [];
    const session = await startSession({ model: scriptedModel([[{ type: "text", text: "Hi." }]], { inputs }), tools: [], chatEndNote: false });
    await session.sendText("hi");
    expect(inputs).toEqual([{ type: "text", text: "hi" }]);
    await session.close();
  });
});

const loud = () => Int16Array.from({ length: 160 }, (_, k) => (k % 2 ? 9000 : -9000));

describe("circling while holding Ctrl+Option", () => {
  test("the crop goes in as its own image the moment the loop closes; release adds only the circle's label", async () => {
    const inputs: ModelInput[] = [];
    const seen: string[] = [];
    const model = scriptedModel([[{ type: "text", text: "That's a pig." }]], { inputs });
    const { eyes, shots } = fakeEyes();
    const session = await startSession({ model, tools: [], eyes, chatEndNote: false });
    session.onEvent((e) => seen.push(e.type));

    // Keys still held: the window saw the ink close.
    expect(await session.screen!.circle(circlePath)).toEqual({ circled: true });
    expect(inputs.map((i) => i.type)).toEqual(["image"]);
    // The loop's box (150..250, 110..190) padded by 48 and grown to 320 x 220, kept on screen.
    expect(shots).toEqual([{ rect: { x: 40, y: 40, w: 320, h: 220 }, ink: [circlePath] }]);

    const releasedAt = performance.now();
    const out = await session.screen!.release({ stroke: circlePath, cursor: { x: 210, y: 160 }, holdMs: 1800 });

    expect(out).toMatchObject({ sent: true, circled: true });
    // The label waits until the frame has had its 1.5 s to land.
    expect(performance.now() - releasedAt).toBeGreaterThan(1400);
    expect(shots).toHaveLength(1); // not captured twice
    expect(inputs.map((i) => i.type)).toEqual(["image", "text"]);
    const text = (inputs[1] as { text: string }).text;
    expect(text).toStartWith("[Circled: the image just sent is the region the user just circled (at the top left of the screen)");
    expect(text).toContain("Answer about what is inside the circle");
    expect(text).toContain("(210, 160)");
    // The window title would pull the answer away from the circle: it stays out of this turn.
    expect(text).not.toContain("Google Chrome");
    expect(text).not.toContain("Wikipedia");
    await Bun.sleep(5);
    expect(seen).toContain("screen.shot");
    expect(seen).toContain("turn.done");
    await session.close();
  });

  test("a circle the window never reported is still sent on release", async () => {
    const inputs: ModelInput[] = [];
    const { eyes, shots } = fakeEyes();
    const session = await startSession({ model: scriptedModel([[{ type: "text", text: "ok" }]], { inputs }), tools: [], eyes, chatEndNote: false, screenFrameGapMs: 0 });
    const out = await session.screen!.release({ stroke: circlePath, cursor: { x: 210, y: 160 }, holdMs: 1800 });
    expect(out).toMatchObject({ sent: true, circled: true });
    expect(shots).toHaveLength(1);
    expect(inputs.map((i) => i.type)).toEqual(["image", "text"]);
    await session.close();
  });

  test("an open stroke with no voice sends nothing (an accidental hold never makes Jett talk)", async () => {
    const inputs: ModelInput[] = [];
    const { eyes, shots } = fakeEyes();
    const session = await startSession({ model: scriptedModel([[]], { inputs }), tools: [], eyes, chatEndNote: false });
    session.sendAudio(new Int16Array(160), 16000); // a held key, a quiet room

    expect(await session.screen!.circle(threeQuarters)).toEqual({ circled: false });
    const out = await session.screen!.release({ stroke: threeQuarters, cursor: { x: 700, y: 500 }, holdMs: 900 });

    expect(out).toEqual({ sent: false, circled: false });
    expect(shots).toEqual([]);
    expect(inputs.filter((i) => i.type !== "audio")).toEqual([]);
    await session.close();
  });

  test("talking with no circle: the context line goes in on release even before any transcript", async () => {
    const inputs: ModelInput[] = [];
    // The mic carries the question; no transcription has arrived yet when the keys come up.
    const model = scriptedModel([[], [{ type: "text", text: "The Pig article's infobox." }]], { inputs });
    const { eyes, shots } = fakeEyes();
    const session = await startSession({ model, tools: [], eyes, chatEndNote: false });
    session.sendAudio(loud(), 16000);

    const started = performance.now();
    const out = await session.screen!.release({ stroke: [{ x: 900, y: 300 }], cursor: { x: 900, y: 300 }, holdMs: 1500 });

    expect(performance.now() - started).toBeLessThan(200); // no waiting on a transcript
    expect(out).toMatchObject({ sent: true, circled: false });
    expect(shots).toEqual([]);
    const text = (inputs.at(-1) as { text: string }).text;
    expect(text).toContain('front app Google Chrome, window "Pigs - Wikipedia"');
    expect(text).toContain("cursor at (900, 300)");
    await session.close();
  });
});

describe("the Gemini Live adapter", () => {
  test("an image goes out as one realtime video frame", async () => {
    const sent: LiveSendRealtimeInputParameters[] = [];
    const model = geminiLiveModel({
      apiKey: "test",
      connect: async (_params: LiveConnectParameters) => ({
        sendRealtimeInput: (p) => void sent.push(p),
        sendToolResponse() {},
        close() {},
      }),
    });
    const session = await model.connect(() => {});
    session.sendImage!(JPEG, "image/jpeg");
    expect(sent).toEqual([{ video: { data: Buffer.from(JPEG).toString("base64"), mimeType: "image/jpeg" } }]);
    await session.close();
  });
});

test("voice is told from a quiet mic", () => {
  expect(isVoice(new Int16Array(320))).toBe(false);
  expect(isVoice(Int16Array.from({ length: 320 }, () => 300))).toBe(false);
  expect(isVoice(loud())).toBe(true);
});
