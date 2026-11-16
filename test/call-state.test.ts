// The orb as a phone call (ticket 37): core state + call + mute -> words, look, buttons.
import { expect, test } from "bun:test";
import { callView, showCallButtons, spaceAction } from "../app/src/call-state.ts";
import { spokenLang } from "../app/src/lang.ts";
import { nextOrb, orbStart, type OrbInput } from "../app/src/orb-state.ts";

const orbAfter = (inputs: OrbInput[]) => inputs.reduce((o, i) => nextOrb(o, i, 0), orbStart).state;

test("starting up: one start button, plain words", () => {
  expect(callView({ orb: "connecting", call: "off", muted: false })).toEqual({ look: "starting", label: "Starting…", buttons: ["start"], mutedBadge: false });
});

test("not in a call: one button only, and the state is Ready", () => {
  const v = callView({ orb: orbAfter([{ type: "core.ready" }]), call: "off", muted: false });
  expect(v.look).toBe("idle");
  expect(v.label).toBe("Ready");
  expect(v.buttons).toEqual(["start"]);
});

test("in a call: exactly Mute and Hang up, and Listening…", () => {
  const v = callView({ orb: "listening", call: "live", muted: false });
  expect(v).toEqual({ look: "listening", label: "Listening…", buttons: ["mute", "hangup"], mutedBadge: false });
});

test("muted: Unmute and Hang up, Muted, the badge", () => {
  expect(callView({ orb: "listening", call: "live", muted: true })).toEqual({ look: "muted", label: "Muted", buttons: ["unmute", "hangup"], mutedBadge: true });
});

test("thinking and speaking come from the core's events", () => {
  const heard: OrbInput[] = [{ type: "core.ready" }, { type: "transcript", role: "user", text: "hi" }, { type: "tick" }];
  expect(nextOrb(nextOrb(orbStart, heard[0]!, 0), heard[1]!, 0)).toMatchObject({ state: "listening" });
  const thinking = heard.reduce((o, i, n) => nextOrb(o, i, n === 2 ? 5000 : 0), orbStart).state;
  expect(callView({ orb: thinking, call: "live", muted: false }).label).toBe("Thinking…");
  const speaking = orbAfter([{ type: "core.ready" }, { type: "transcript", role: "model", text: "Hello" }]);
  expect(callView({ orb: speaking, call: "live", muted: false })).toMatchObject({ look: "speaking", label: "Speaking…" });
});

test("Jett speaking while you are muted: Speaking…, with the muted badge", () => {
  expect(callView({ orb: "speaking", call: "live", muted: true })).toMatchObject({ look: "speaking", mutedBadge: true, buttons: ["unmute", "hangup"] });
});

test("connecting to the room: Connecting…, only Hang up", () => {
  expect(callView({ orb: "listening", call: "joining", muted: false })).toMatchObject({ look: "joining", label: "Connecting…", buttons: ["hangup"] });
});

test("just hung up: Call ended, with the one start button", () => {
  expect(callView({ orb: "listening", call: "ended", muted: false })).toMatchObject({ look: "ended", label: "Call ended", buttons: ["start"] });
});

test("a typed turn with no call still shows Thinking… and Speaking…", () => {
  expect(callView({ orb: "thinking", call: "off", muted: false })).toMatchObject({ look: "thinking", buttons: ["start"] });
});

test("the core down: Can't reach Gemini with Retry; only Hang up, and only in a call (ticket 40)", () => {
  expect(callView({ orb: "offline", call: "live", muted: false })).toMatchObject({ look: "offline", buttons: ["hangup"], retry: "Retry" });
  expect(callView({ orb: "offline", call: "off", muted: false })).toMatchObject({ look: "offline", buttons: [] });
});

test("a core pause never shows as Muted: only the user's mute does", () => {
  const paused = orbAfter([{ type: "core.ready" }, { type: "paused", paused: true }]);
  expect(callView({ orb: paused, call: "live", muted: false }).look).toBe("listening");
});

test("Space: start a call, then mute and unmute; nothing while connecting", () => {
  expect(spaceAction("off", false)).toBe("start");
  expect(spaceAction("ended", false)).toBe("start");
  expect(spaceAction("live", false)).toBe("mute");
  expect(spaceAction("live", true)).toBe("unmute");
  expect(spaceAction("joining", false)).toBeUndefined();
});

test("the words follow the user's language", () => {
  expect(callView({ orb: "listening", call: "live", muted: false, lang: "zh" }).label).toBe("在听…");
  expect(callView({ orb: "listening", call: "off", muted: false, lang: "zh" }).label).toBe("就绪");
  expect(spokenLang("你好，今天有什么安排")).toBe("zh");
  expect(spokenLang("what's on today")).toBe("en");
  expect(spokenLang("Jett 你好")).toBe("zh");
  expect(spokenLang("42")).toBeUndefined();
});

// Ticket 39: less on screen at rest during a call.
test("in a call, Mute and Hang up show only on hover or while someone is actually talking", () => {
  expect(showCallButtons({ look: "muted", inCall: true, hovered: false, talking: false })).toBe(false);
  expect(showCallButtons({ look: "listening", inCall: true, hovered: false, talking: false })).toBe(false);
  expect(showCallButtons({ look: "listening", inCall: true, hovered: false, talking: true })).toBe(true);
  expect(showCallButtons({ look: "speaking", inCall: true, hovered: false, talking: false })).toBe(true);
  expect(showCallButtons({ look: "thinking", inCall: true, hovered: false, talking: false })).toBe(false);
  expect(showCallButtons({ look: "muted", inCall: true, hovered: true, talking: false })).toBe(true);
  expect(showCallButtons({ look: "joining", inCall: true, hovered: false, talking: false })).toBe(false);
  // Not in a call: the Start call button stays, it is how you begin.
  expect(showCallButtons({ look: "idle", inCall: false, hovered: false, talking: false })).toBe(true);
});
