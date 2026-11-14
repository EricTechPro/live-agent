// The window's orb: which state it shows for each thing the core tells it.
// Pure mapping from agent-core events (plus a few window-side signals) to
// listening / thinking / speaking, so voice and typed turns drive the same orb.
import { describe, expect, test } from "bun:test";
import { orbStart, nextOrb, type OrbInput, type Orb } from "../app/src/orb-state.ts";

const ready = (): Orb => nextOrb(orbStart, { type: "core.ready" }, 0);

/** Feed inputs in order, each at its own time in ms; return the states seen. */
function run(inputs: [number, OrbInput][], from: Orb = ready()) {
  let orb = from;
  return inputs.map(([now, input]) => (orb = nextOrb(orb, input, now)).state);
}

describe("orb state", () => {
  test("it shows connecting until the core is ready, then listening", () => {
    expect(orbStart.state).toBe("connecting");
    expect(ready().state).toBe("listening");
  });

  test("a spoken turn goes listening, thinking once you pause, speaking, then back to listening", () => {
    expect(
      run([
        [100, { type: "transcript", role: "user", text: "what's on" }],
        [400, { type: "transcript", role: "user", text: " today" }],
        [600, { type: "tick" }], // 200 ms after your last words: still listening
        [1300, { type: "tick" }], // 900 ms of quiet: the model is working on it
        [1500, { type: "transcript", role: "model", text: "You have" }],
        [1700, { type: "transcript", role: "model", text: " two calls." }],
        [1800, { type: "turn.done", reply: "You have two calls." }],
      ]),
    ).toEqual(["listening", "listening", "listening", "thinking", "speaking", "speaking", "listening"]);
  });

  test("a typed turn thinks straight away, and tool work keeps it thinking", () => {
    expect(
      run([
        [0, { type: "turn.sent" }],
        [10, { type: "tool.call", id: "1", name: "search_brain", args: {}, risk: "read" }],
        [20, { type: "tool.result", id: "1", name: "search_brain", status: "ok" }],
        [30, { type: "transcript", role: "model", text: "Found it." }],
        [40, { type: "turn.done", reply: "Found it." }],
      ]),
    ).toEqual(["thinking", "thinking", "thinking", "speaking", "listening"]);
  });

  test("the core's echo of your typed words does not flip it back to listening", () => {
    expect(
      run([
        [0, { type: "turn.sent" }],
        [5, { type: "transcript", role: "user", text: "hi" }],
        [1000, { type: "tick" }],
        [1100, { type: "transcript", role: "user", text: "and also" }], // you speak afterwards: listening again
      ]),
    ).toEqual(["thinking", "thinking", "thinking", "listening"]);
  });

  test("a tool call while it is talking does not cut the speaking state (non-blocking tools)", () => {
    expect(
      run([
        [0, { type: "transcript", role: "model", text: "Let me look." }],
        [10, { type: "tool.call", id: "1", name: "search_brain", args: {}, risk: "read" }],
      ]),
    ).toEqual(["speaking", "speaking"]);
  });

  test("talking over it stops the speaking state at once", () => {
    expect(
      run([
        [0, { type: "transcript", role: "model", text: "The long answer is" }],
        [10, { type: "interrupted" }],
        [20, { type: "transcript", role: "user", text: "stop" }],
      ]),
    ).toEqual(["speaking", "listening", "listening"]);
  });

  test("it keeps speaking while its voice is still playing after the turn is done", () => {
    expect(
      run([
        [0, { type: "agent.audio", speaking: true }],
        [10, { type: "transcript", role: "model", text: "Hello there." }],
        [20, { type: "turn.done", reply: "Hello there." }],
        [900, { type: "agent.audio", speaking: false }],
      ]),
    ).toEqual(["speaking", "speaking", "speaking", "listening"]);
  });

  test("when the core goes down the orb shows offline and ignores stray events until it is back", () => {
    expect(
      run([
        [0, { type: "core.down" }],
        [10, { type: "transcript", role: "model", text: "late chunk" }],
        [20, { type: "core.ready" }],
      ]),
    ).toEqual(["offline", "offline", "listening"]);
  });
});
